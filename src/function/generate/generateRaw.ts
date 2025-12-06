import {
  BaseData,
  RolePrompt,
  builtin_prompt_default_order,
  character_names_behavior,
  default_order,
  detail,
} from '@/function/generate/types';
import { convertFileToBase64, getPromptRole, isPromptFiltered } from '@/function/generate/utils';
import { InjectionPrompt, injectPrompts } from '@/function/inject';
import {
  MAX_INJECTION_DEPTH,
  eventSource,
  event_types,
  extension_prompts,
  getExtensionPromptByName,
  substituteParams,
} from '@sillytavern/script';
import { NOTE_MODULE_NAME } from '@sillytavern/scripts/authors-note';
import {
  ChatCompletion,
  Message,
  MessageCollection,
  isImageInliningSupported,
  oai_settings,
  setupChatCompletionPromptManager,
} from '@sillytavern/scripts/openai';
import { persona_description_positions, power_user } from '@sillytavern/scripts/power-user';
import { Prompt, PromptCollection } from '@sillytavern/scripts/PromptManager';
import { uuidv4 } from '@sillytavern/scripts/utils';

/**
 * @fileoverview Raw generation path processing module - generation logic without using presets
 * Contains all prompt processing and chat completion logic when not using presets (use_preset=false)
 */

/**
 * Convert system prompts to collection format
 * Processes built-in prompts, custom injections, and dialogue examples, converting them to PromptCollection and MessageCollection format
 * @param baseData Base data containing character info and world info
 * @param promptConfig Prompt configuration parameters, including order settings
 * @returns Promise<{systemPrompts: PromptCollection, dialogue_examples: MessageCollection}> Returns collections of system prompts and dialogue examples
 */
async function convertSystemPromptsToCollection(
  baseData: any,
  promptConfig: Omit<detail.GenerateParams, 'user_input' | 'use_preset'>,
) {
  const promptCollection = new PromptCollection();
  const examplesCollection = new MessageCollection('dialogue_examples');

  const orderArray = promptConfig.order || builtin_prompt_default_order;

  const builtinPromptContents = {
    world_info_before: baseData.worldInfo.worldInfoBefore,
    persona_description:
      power_user.persona_description &&
      power_user.persona_description_position === persona_description_positions.IN_PROMPT
        ? baseData.characterInfo.persona
        : null,
    char_description: baseData.characterInfo.description,
    char_personality: baseData.characterInfo.personality,
    scenario: baseData.characterInfo.scenario,
    world_info_after: baseData.worldInfo.worldInfoAfter,
  };

  for (const [index, item] of orderArray.entries()) {
    if (typeof item === 'string') {
      // Process built-in prompts
      const content = builtinPromptContents[item as keyof typeof builtinPromptContents];
      if (content) {
        promptCollection.add(
          new Prompt({
            identifier: item,
            role: 'system',
            content: content,
            system_prompt: true,
          }),
        );
      }
    } else if (typeof item === 'object' && item.role && item.content) {
      // Process custom injections
      const identifier = `custom_prompt_${index}`;
      promptCollection.add(
        new Prompt({
          identifier: identifier,
          role: item.role,
          content: item.content,
          system_prompt: item.role === 'system',
        }),
      );
    }
  }

  if (baseData.chatContext.oaiMessageExamples.length > 0) {
    // Iterate through all dialogue examples
    for (const dialogue of [...baseData.chatContext.oaiMessageExamples]) {
      const dialogueIndex = baseData.chatContext.oaiMessageExamples.indexOf(dialogue);
      const chatMessages = [];

      for (let promptIndex = 0; promptIndex < dialogue.length; promptIndex++) {
        const prompt = dialogue[promptIndex];
        const role = 'system';
        const content = prompt.content || '';
        const identifier = `dialogue_examples ${dialogueIndex}-${promptIndex}`;

        const chatMessage = await Message.createAsync(role, content, identifier);
        await chatMessage.setName(prompt.name);
        chatMessages.push(chatMessage);
      }
      for (const message of chatMessages) {
        examplesCollection.add(message);
      }
    }
  }
  return {
    systemPrompts: promptCollection,
    dialogue_examples: examplesCollection,
  };
}

/**
 * Process chat history and inject prompts
 * Processes chat history and user input based on order configuration, and injects various depth prompts
 * @param baseData Base data containing chat context
 * @param promptConfig Prompt configuration parameters
 * @param chatCompletion ChatCompletion object for managing token budget and message collections
 * @param processedUserInput Processed user input text
 * @param processedImageArray Optional processed image array for multi-image support
 * @returns Promise<void> No return value, directly modifies the chatCompletion object
 */
async function processChatHistoryAndInject(
  baseData: any,
  promptConfig: Omit<detail.GenerateParams, 'user_input' | 'use_preset'>,
  chatCompletion: ChatCompletion,
  processedUserInput: string,
  processedImageArray?: { type: string; text?: string; image_url?: { url: string; detail: string } }[] | null,
) {
  const orderArray = promptConfig.order || default_order;
  const chatHistoryIndex = orderArray.findIndex(
    item => typeof item === 'string' && item.toLowerCase() === 'chat_history',
  );
  const userInputIndex = orderArray.findIndex(item => typeof item === 'string' && item.toLowerCase() === 'user_input');

  const hasUserInput = userInputIndex !== -1;
  const hasChatHistory = chatHistoryIndex !== -1;
  const isChatHistoryFiltered = isPromptFiltered('chat_history', promptConfig);

  // Create user input message
  let userMessage: Message;

  if (processedImageArray && hasUserInput) {
    // If there's a processed image array, directly use array format to create message
    userMessage = await Message.createAsync('user', processedImageArray as any, 'user_input');
  } else {
    // Otherwise use original logic
    userMessage = await Message.createAsync('user', processedUserInput, 'user_input');

    if (promptConfig.image && hasUserInput) {
      if (!Array.isArray(promptConfig.image)) {
        const img = await convertFileToBase64(promptConfig.image);
        if (img) {
          await userMessage.addImage(img);
        }
      }
    }
  }

  // If chat history is filtered or not in order, only process user input
  if (isChatHistoryFiltered || !hasChatHistory) {
    const insertIndex = hasUserInput ? userInputIndex : orderArray.length;
    chatCompletion.add(new MessageCollection('user_input', userMessage), insertIndex);
    return;
  }

  // Process chat history
  const chatCollection = new MessageCollection('chat_history');

  // Reserve tokens for new chat indicator
  const newChat = oai_settings.new_chat_prompt;
  const newChatMessage = await Message.createAsync('system', substituteParams(newChat), 'newMainChat');
  chatCompletion.reserveBudget(newChatMessage);

  // Add new chat prompt to the beginning of the collection
  chatCollection.add(newChatMessage);

  // Handle empty message replacement
  const lastChatPrompt = baseData.chatContext.oaiMessages[baseData.chatContext.oaiMessages.length - 1];
  const emptyMessage = await Message.createAsync('user', oai_settings.send_if_empty, 'emptyUserMessageReplacement');

  if (
    lastChatPrompt &&
    lastChatPrompt.role === 'assistant' &&
    oai_settings.send_if_empty &&
    chatCompletion.canAfford(emptyMessage)
  ) {
    chatCollection.add(emptyMessage);
  }

  // Add user message to message array for injection processing
  if (!hasUserInput) {
    let userPrompt: any;

    if (processedImageArray) {
      // If there's a processed image array, use array format
      userPrompt = {
        role: 'user',
        content: processedImageArray,
        identifier: 'user_input',
      };
    } else {
      // Otherwise use original logic
      userPrompt = {
        role: 'user',
        content: processedUserInput,
        identifier: 'user_input',
        image:
          promptConfig.image && !Array.isArray(promptConfig.image)
            ? await convertFileToBase64(promptConfig.image)
            : undefined,
      };
    }

    baseData.chatContext.oaiMessages.unshift(userPrompt);
  }

  // Process injections and add messages
  const messages = (
    await populationInjectionPrompts(baseData, baseData.chatContext.oaiMessages, promptConfig.inject, promptConfig)
  ).reverse();
  const imageInlining = isImageInliningSupported();
  // Add chat history
  const chatPool = [...messages];
  for (const chatPrompt of chatPool) {
    const prompt = new Prompt(chatPrompt as any);
    prompt.identifier = `chat_history-${messages.length - chatPool.indexOf(chatPrompt)}`;
    prompt.content = substituteParams(prompt.content);

    const chatMessage = await Message.fromPromptAsync(prompt);
    const promptManager = setupChatCompletionPromptManager(oai_settings);

    if (promptManager) {
      // @ts-expect-error Type is correct
      if (promptManager.serviceSettings.names_behavior === character_names_behavior.COMPLETION && prompt.name) {
        const messageName = promptManager.isValidName(prompt.name)
          ? prompt.name
          : promptManager.sanitizeName(prompt.name);
        await chatMessage.setName(messageName);
      }
    }
    if (imageInlining && chatPrompt.image) {
      await chatMessage.addImage(chatPrompt.image as string);
    }
    if (chatCompletion.canAfford(chatMessage)) {
      chatCollection.add(chatMessage);
    } else {
      break;
    }
  }

  // Release reserved tokens for new chat prompt
  chatCompletion.freeBudget(newChatMessage);

  if (hasUserInput) {
    // Add chat history and user input according to their positions in order
    chatCompletion.add(chatCollection, chatHistoryIndex);
    chatCompletion.add(new MessageCollection('user_input', userMessage), userInputIndex);
  } else {
    // Chat history already contains user input, add directly to chat_history position
    chatCompletion.add(chatCollection, chatHistoryIndex);
  }
}

/**
 * Process injection prompts
 * Injects various prompts by depth, including author's note, user description, world book depth entries, and custom injections
 * @param baseData Base data containing world info
 * @param messages Original message array
 * @param customInjects Array of custom injection prompts
 * @param config Configuration parameters for filter checking
 * @returns Promise<RolePrompt[]> Processed message array containing all injected prompts
 */
async function populationInjectionPrompts(
  baseData: BaseData,
  messages: RolePrompt[],
  customInjects: Omit<InjectionPrompt, 'id'>[] = [],
  config: Omit<detail.GenerateParams, 'user_input' | 'use_preset'>,
) {
  const processedMessages = [...messages];
  let totalInsertedMessages = 0;
  const injectionPrompts = [];

  const authorsNote = _.get(extension_prompts, NOTE_MODULE_NAME, {}) as any;
  if (authorsNote && authorsNote.value) {
    injectionPrompts.push({
      role: getPromptRole(authorsNote.role),
      content: authorsNote.value,
      identifier: 'authorsNote',
      injection_depth: authorsNote.depth,
      injected: true,
    });
  }

  if (
    power_user.persona_description &&
    power_user.persona_description_position === persona_description_positions.AT_DEPTH
  ) {
    injectionPrompts.push({
      role: 'system',
      content: power_user.persona_description,
      identifier: 'persona_description',
      injection_depth: power_user.persona_description_depth,
      injected: true,
    });
  }

  if (!isPromptFiltered('char_depth_prompt', config)) {
    const wiDepthPrompt = baseData.worldInfo.worldInfoDepth;
    if (wiDepthPrompt) {
      for (const entry of wiDepthPrompt) {
        const content = await getExtensionPromptByName(`customDepthWI-${entry.depth}-${entry.role}`);
        injectionPrompts.push({
          role: getPromptRole(entry.role),
          content: content,
          injection_depth: entry.depth,
          injected: true,
        });
      }
    }
  }

  // Process custom injections
  if (Array.isArray(customInjects)) {
    injectPrompts(
      customInjects.map(inject => ({ id: uuidv4(), ...inject })),
      { once: true },
    );
  }

  for (let i = 0; i <= MAX_INJECTION_DEPTH; i++) {
    const depthPrompts = injectionPrompts.filter(prompt => prompt.injection_depth === i && prompt.content);

    const roles = ['system', 'user', 'assistant'];
    const roleMessages = [];
    const separator = '\n';

    for (const role of roles) {
      // Directly process all prompts for current depth and role
      const rolePrompts = depthPrompts
        .filter(prompt => prompt.role === role)
        .map(x => x.content.trim())
        .join(separator);

      if (rolePrompts) {
        roleMessages.push({
          role: role as 'user' | 'system' | 'assistant',
          content: rolePrompts,
          injected: true,
        });
      }
    }

    if (roleMessages.length) {
      const injectIdx = i + totalInsertedMessages;
      processedMessages.splice(injectIdx, 0, ...roleMessages);
      totalInsertedMessages += roleMessages.length;
    }
  }

  return processedMessages;
}

/**
 * Handle raw generation path (without using presets)
 * Builds ChatCompletion object, processes various prompts according to specified order, manages token budget
 * @param baseData Base data containing character info, chat context, and world info
 * @param config Configuration parameters including image, override settings, injections, etc.
 * @param processedUserInput Processed user input text
 * @returns Promise<{prompt: any}> Generation data object containing the final prompt
 */
export async function handleCustomPath(
  baseData: any,
  config: Omit<detail.GenerateParams, 'user_input' | 'use_preset'> & {
    processedImageArray?: { type: string; text?: string; image_url?: { url: string; detail: string } }[] | null;
  },
  processedUserInput: string,
) {
  const chatCompletion = new ChatCompletion();
  chatCompletion.setTokenBudget(oai_settings.openai_max_context, oai_settings.openai_max_tokens);
  chatCompletion.reserveBudget(3);
  const orderArray = config.order || default_order;
  const positionMap: Record<string, number> = orderArray.reduce((acc: Record<string, number>, item, index) => {
    if (typeof item === 'string') {
      acc[item.toLowerCase()] = index;
    } else if (typeof item === 'object') {
      acc[`custom_prompt_${index}`] = index;
    }
    return acc;
  }, {});

  // Convert to collections
  const { systemPrompts, dialogue_examples } = await convertSystemPromptsToCollection(baseData, config);
  const addToChatCompletionInOrder = async (source: any, index: number) => {
    if (typeof source === 'object') {
      // Process custom injections
      const collection = new MessageCollection(`custom_prompt_${index}`);
      const message = await Message.createAsync(source.role, source.content, `custom_prompt_${index}`);
      collection.add(message);
      chatCompletion.add(collection, index);
    } else if (systemPrompts.has(source)) {
      // Process regular prompts
      const prompt = systemPrompts.get(source);
      const collection = new MessageCollection(source);
      const message = await Message.fromPromptAsync(prompt);
      collection.add(message);
      chatCompletion.add(collection, positionMap[source]);
    }
  };

  // Process all types of prompts
  for (const [index, item] of orderArray.entries()) {
    if (typeof item === 'string') {
      if (!isPromptFiltered(item, config)) {
        await addToChatCompletionInOrder(item, index);
      }
    } else if (typeof item === 'object' && item.role && item.content) {
      await addToChatCompletionInOrder(item, index);
    }
  }

  const dialogue_examplesIndex = orderArray.findIndex(
    item => typeof item === 'string' && item.toLowerCase() === 'dialogue_examples',
  );

  if (dialogue_examplesIndex !== -1 && !isPromptFiltered('dialogue_examples', config)) {
    chatCompletion.add(dialogue_examples, dialogue_examplesIndex);
  }
  // Reserve tokens for user input
  const userInputMessage = await Message.createAsync('user', processedUserInput, 'user_input');
  chatCompletion.reserveBudget(userInputMessage);

  await processChatHistoryAndInject(baseData, config, chatCompletion, processedUserInput, config.processedImageArray);
  chatCompletion.freeBudget(userInputMessage);

  // Decide whether to merge consecutive system role messages based on current preset
  if (oai_settings.squash_system_messages) {
    await chatCompletion.squashSystemMessages();
  }
  const prompt = chatCompletion.getChat();
  eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, { chat: prompt, dryRun: false });
  return { prompt };
}
