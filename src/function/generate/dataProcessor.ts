import { detail, RolePrompt } from '@/function/generate/types';
import {
  addTemporaryUserMessage,
  clearInjectionPrompts,
  isPromptFiltered,
  parseMesExamples,
  removeTemporaryUserMessage,
} from '@/function/generate/utils';
import { injectPrompts } from '@/function/inject';
import {
  baseChatReplace,
  characters,
  chat,
  chat_metadata,
  extension_prompt_types,
  extension_prompts,
  getBiasStrings,
  getCharacterCardFields,
  getExtensionPromptRoleByName,
  getMaxContextSize,
  name1,
  name2,
  setExtensionPrompt,
  this_chid,
} from '@sillytavern/script';
import { metadata_keys, NOTE_MODULE_NAME, shouldWIAddPrompt } from '@sillytavern/scripts/authors-note';
import { extension_settings } from '@sillytavern/scripts/extensions';
import { getRegexedString, regex_placement } from '@sillytavern/scripts/extensions/regex/engine';
import { setOpenAIMessageExamples, setOpenAIMessages } from '@sillytavern/scripts/openai';
import { persona_description_positions, power_user } from '@sillytavern/scripts/power-user';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { getWorldInfoPrompt, wi_anchor_position, world_info_include_names } from '@sillytavern/scripts/world-info';

/**
 * Core function for preparing and overriding data
 * @param config Configuration parameters
 * @param processedUserInput Processed user input
 * @returns Data object containing character info, chat context, and world info
 */
export async function prepareAndOverrideData(
  config: Omit<detail.GenerateParams, 'user_input' | 'use_preset'>,
  processedUserInput: string,
) {
  const getOverrideContent = (identifier: string): string | RolePrompt[] | undefined => {
    if (!config.overrides) return undefined;
    const value = config.overrides[identifier as keyof detail.OverrideConfig];
    if (typeof value === 'boolean') return undefined;
    return value;
  };

  // 1. Handle character card advanced definition character notes - only execute when chat_history is not filtered
  if (!isPromptFiltered('chat_history', config)) {
    handleCharDepthPrompt();
  }

  // 2. Set author's note - only execute when chat_history is not filtered
  if (!isPromptFiltered('chat_history', config) && !isPromptFiltered('author_note', config)) {
    setAuthorNotePrompt(config);
  }

  // 3. Handle user persona description - only execute when both chat_history and persona_description are not filtered
  if (!isPromptFiltered('chat_history', config) && !isPromptFiltered('persona_description', config)) {
    setPersonaDescriptionExtensionPrompt();
  }

  const character = characters.at(this_chid as unknown as number);

  // 4. Get character card base fields
  const charDepthPrompt = baseChatReplace(character?.data?.extensions?.depth_prompt?.prompt?.trim(), name1, name2);
  const creatorNotes = baseChatReplace(character?.data?.creator_notes?.trim(), name1, name2);
  const {
    description: rawDescription,
    personality: rawPersonality,
    persona: rawPersona,
    scenario: rawScenario,
    mesExamples: rawMesExamples,
    system,
    jailbreak,
  } = getCharacterCardFields();

  // Check if filtered - if filtered return empty string, otherwise return override value or original value
  const description = isPromptFiltered('char_description', config)
    ? ''
    : (getOverrideContent('char_description') ?? rawDescription);

  const personality = isPromptFiltered('char_personality', config)
    ? ''
    : (getOverrideContent('char_personality') ?? rawPersonality);

  const persona = isPromptFiltered('persona_description', config)
    ? ''
    : (getOverrideContent('persona_description') ?? rawPersona);

  const scenario = isPromptFiltered('scenario', config) ? '' : (getOverrideContent('scenario') ?? rawScenario);

  const mesExamples = isPromptFiltered('dialogue_examples', config)
    ? ''
    : ((getOverrideContent('dialogue_examples') as string) ?? rawMesExamples);

  let mesExamplesArray = parseMesExamples(mesExamples);
  let oaiMessageExamples = [];
  oaiMessageExamples = setOpenAIMessageExamples(mesExamplesArray);

  // 5. Get bias strings
  const { promptBias } = getBiasStrings(processedUserInput, 'normal');

  // 6. Handle custom injected prompts
  if (config.inject) {
    await handleInjectedPrompts(config);
  }

  // 7. Process chat history
  let oaiMessages = [];
  if (config.overrides?.chat_history) {
    oaiMessages = [...config.overrides.chat_history].reverse();
  } else {
    oaiMessages = setOpenAIMessages(await processChatHistory(chat));
    if (config.max_chat_history !== undefined) {
      oaiMessages = oaiMessages.slice(0, config.max_chat_history);
    }
  }

  // Add temporary message for activating world book
  addTemporaryUserMessage(processedUserInput);
  // 8. Process world info
  const worldInfo = await processWorldInfo(oaiMessages as RolePrompt[], config, {
    description: rawDescription,
    personality: rawPersonality,
    persona: rawPersona,
    scenario: rawScenario,
    charDepthPrompt,
    creatorNotes,
  });

  // Remove temporary message
  removeTemporaryUserMessage();

  // 9. Process world book message examples
  mesExamplesArray = !isPromptFiltered('dialogue_examples', config)
    ? await processMessageExamples(mesExamplesArray, worldInfo.worldInfoExamples)
    : [];

  return {
    characterInfo: {
      description,
      personality,
      persona,
      scenario,
      system: system,
      jailbreak: jailbreak,
    },
    chatContext: {
      oaiMessages,
      oaiMessageExamples,
      promptBias,
    },
    worldInfo,
  };
}

/**
 * Handle depth prompts in character card
 */
function handleCharDepthPrompt() {
  const character = characters.at(this_chid as unknown as number);
  const depthPromptText =
    baseChatReplace(character?.data?.extensions?.depth_prompt?.prompt?.trim(), name1, name2) || '';
  const depthPromptDepth = character?.data?.extensions?.depth_prompt?.depth ?? 4;
  const depthPromptRole = getExtensionPromptRoleByName(character?.data?.extensions?.depth_prompt?.role ?? 'system');
  setExtensionPrompt(
    'DEPTH_PROMPT',
    depthPromptText,
    extension_prompt_types.IN_CHAT,
    depthPromptDepth,
    // @ts-expect-error Type is correct
    extension_settings.note.allowWIScan,
    depthPromptRole,
  );
}

/**
 * Handle author's note
 */
function setAuthorNotePrompt(config: detail.GenerateParams) {
  const authorNoteOverride = config?.overrides?.author_note;
  const prompt = authorNoteOverride ?? ($('#extension_floating_prompt').val() as string);

  setExtensionPrompt(
    NOTE_MODULE_NAME,
    prompt,
    // @ts-expect-error Type is correct
    chat_metadata[metadata_keys.position],
    // @ts-expect-error Type is correct
    chat_metadata[metadata_keys.depth],
    // @ts-expect-error Type is correct
    extension_settings.note.allowWIScan,
    // @ts-expect-error Type is correct
    chat_metadata[metadata_keys.role],
  );
}

/**
 * Handle case where user persona description prompt is set as an option outside the prompt manager
 */
function setPersonaDescriptionExtensionPrompt() {
  const description = power_user.persona_description;
  const INJECT_TAG = 'PERSONA_DESCRIPTION';
  setExtensionPrompt(INJECT_TAG, '', extension_prompt_types.IN_PROMPT, 0);

  if (!description || power_user.persona_description_position === persona_description_positions.NONE) {
    return;
  }

  // When user info is before/after author's note - only execute when author's note is not filtered
  const promptPositions = [persona_description_positions.BOTTOM_AN, persona_description_positions.TOP_AN];

  if (promptPositions.includes(power_user.persona_description_position) && shouldWIAddPrompt) {
    const originalAN = _.get(extension_prompts, NOTE_MODULE_NAME) as any;
    const ANWithDesc =
      power_user.persona_description_position === persona_description_positions.TOP_AN
        ? `${description}\n${originalAN}`
        : `${originalAN}\n${description}`;

    setExtensionPrompt(
      NOTE_MODULE_NAME,
      ANWithDesc,
      // @ts-expect-error Type is correct
      chat_metadata[metadata_keys.position],
      // @ts-expect-error Type is correct
      chat_metadata[metadata_keys.depth],
      // @ts-expect-error Type is correct
      extension_settings.note.allowWIScan,
      // @ts-expect-error Type is correct
      chat_metadata[metadata_keys.role],
    );
  }

  // User info depth injection does not depend on author's note state, apply directly
  if (power_user.persona_description_position === persona_description_positions.AT_DEPTH) {
    setExtensionPrompt(
      INJECT_TAG,
      description,
      extension_prompt_types.IN_CHAT,
      power_user.persona_description_depth,
      true,
      power_user.persona_description_role,
    );
  }
}

/**
 * Handle injected prompts
 */
async function handleInjectedPrompts(promptConfig: Omit<detail.GenerateParams, 'user_input' | 'use_preset'>) {
  if (!promptConfig || !Array.isArray(promptConfig.inject)) return;
  injectPrompts(
    promptConfig.inject.map(prompt => ({ id: uuidv4(), ...prompt })),
    { once: true },
  );
}

/**
 * Process chat history
 */
async function processChatHistory(chatHistory: any[]) {
  const coreChat = chatHistory.filter(x => !x.is_system);

  return await Promise.all(
    coreChat.map(async (chatItem, index) => {
      const message = chatItem.mes;
      const regexType = chatItem.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;

      const regexedMessage = getRegexedString(message, regexType, {
        isPrompt: true,
        depth: coreChat.length - index - 1,
      });

      return {
        ...chatItem,
        mes: regexedMessage,
        index,
      };
    }),
  );
}

/**
 * Process world book/world info
 */
async function processWorldInfo(
  oaiMessages: RolePrompt[],
  config: Omit<detail.GenerateParams, 'user_input' | 'use_preset'>,
  characterInfo: {
    description: string;
    personality: string;
    persona: string;
    scenario: string;
    charDepthPrompt: string;
    creatorNotes: string;
  },
) {
  const chatForWI = oaiMessages
    .filter(x => x.role !== 'system')
    .map(x => {
      const name = x.role === 'user' ? name1 : name2;
      return world_info_include_names ? `${name}: ${x.content}` : x.content;
    })
    .reverse();

  const this_max_context = getMaxContextSize();
  const globalScanData = {
    personaDescription: config.overrides?.persona_description ?? characterInfo.persona,
    characterDescription: config.overrides?.char_description ?? characterInfo.description,
    characterPersonality: config.overrides?.char_personality ?? characterInfo.personality,
    characterDepthPrompt: characterInfo.charDepthPrompt,
    scenario: config.overrides?.scenario ?? characterInfo.scenario,
    creatorNotes: characterInfo.creatorNotes,
  };
  const { worldInfoString, worldInfoBefore, worldInfoAfter, worldInfoExamples, worldInfoDepth } =
    // @ts-expect-error Not considering the new trigger field
    await getWorldInfoPrompt(chatForWI, this_max_context, false, globalScanData);

  await clearInjectionPrompts(['customDepthWI']);

  if (!isPromptFiltered('with_depth_entries', config)) {
    processWorldInfoDepth(worldInfoDepth);
  }

  // First check if filtered - if filtered return null directly
  const finalWorldInfoBefore = isPromptFiltered('world_info_before', config)
    ? null
    : config.overrides?.world_info_before !== undefined
      ? config.overrides.world_info_before
      : worldInfoBefore;

  const finalWorldInfoAfter = isPromptFiltered('world_info_after', config)
    ? null
    : config.overrides?.world_info_after !== undefined
      ? config.overrides.world_info_after
      : worldInfoAfter;

  return {
    worldInfoString,
    worldInfoBefore: finalWorldInfoBefore,
    worldInfoAfter: finalWorldInfoAfter,
    worldInfoExamples,
    worldInfoDepth: !isPromptFiltered('with_depth_entries', config) ? worldInfoDepth : null,
  };
}

/**
 * Process world info depth section
 */
function processWorldInfoDepth(worldInfoDepth: any[]) {
  if (Array.isArray(worldInfoDepth)) {
    worldInfoDepth.forEach(entry => {
      const joinedEntries = entry.entries.join('\n');
      setExtensionPrompt(
        `customDepthWI-${entry.depth}-${entry.role}`,
        joinedEntries,
        extension_prompt_types.IN_CHAT,
        entry.depth,
        false,
        entry.role,
      );
    });
  }
}

/**
 * Process world book example messages (before/after)
 */
async function processMessageExamples(mesExamplesArray: string[], worldInfoExamples: any[]): Promise<string[]> {
  // Process examples from world info
  for (const example of worldInfoExamples) {
    if (!example.content.length) continue;

    const formattedExample = baseChatReplace(example.content, name1, name2);
    const cleanedExample = parseMesExamples(formattedExample);

    if (example.position === wi_anchor_position.before) {
      mesExamplesArray.unshift(...cleanedExample);
    } else {
      mesExamplesArray.push(...cleanedExample);
    }
  }

  return mesExamplesArray;
}
