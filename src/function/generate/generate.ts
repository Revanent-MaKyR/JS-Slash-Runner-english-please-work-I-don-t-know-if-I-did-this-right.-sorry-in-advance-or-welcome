import { characters, name2, this_chid } from '@sillytavern/script';
import { getContext } from '@sillytavern/scripts/extensions';
import { prepareOpenAIMessages } from '@sillytavern/scripts/openai';
import { detail } from '@/function/generate/types';
import { convertFileToBase64 } from '@/function/generate/utils';
const dryRun = false;
/**
 * Handle generation request using preset path
 * @param baseData Base data
 * @param processedUserInput Processed user input
 * @param config Configuration parameters
 * @returns Generation data
 */
export async function handlePresetPath(
  baseData: any,
  processedUserInput: string,
  config: Omit<detail.GenerateParams, 'user_input' | 'use_preset'>,
) {
  // prepareOpenAIMessages reads scenario from settings, so temporarily override it
  let originalScenario = null;
  const character = characters.at(this_chid as unknown as number);
  try {
    const scenarioOverride = config?.overrides?.scenario;
    if (scenarioOverride && character) {
      // Save original scenario
      originalScenario = character.scenario || null;
      character.scenario = scenarioOverride;
    }
    // Add user message (one-time)
    const userMessageTemp = {
      role: 'user',
      content: processedUserInput,
      image: config.image,
    };
    if (config.image) {
      if (Array.isArray(config.image)) {
        delete userMessageTemp.image;
      } else {
        userMessageTemp.image = await convertFileToBase64(config.image);
      }
    }
    baseData.chatContext.oaiMessages.unshift(userMessageTemp);
    const messageData = {
      name2,
      charDescription: baseData.characterInfo.description,
      charPersonality: baseData.characterInfo.personality,
      Scenario: baseData.characterInfo.scenario,
      worldInfoBefore: baseData.worldInfo.worldInfoBefore,
      worldInfoAfter: baseData.worldInfo.worldInfoAfter,
      extensionPrompts: getContext().extensionPrompts,
      bias: baseData.chatContext.promptBias,
      type: 'normal',
      quietPrompt: '',
      quietImage: null,
      cyclePrompt: '',
      systemPromptOverride: baseData.characterInfo.system,
      jailbreakPromptOverride: baseData.characterInfo.jailbreak,
      personaDescription: baseData.characterInfo.persona,
      messages: baseData.chatContext.oaiMessages,
      messageExamples: baseData.chatContext.oaiMessageExamples,
    };
    const [prompt] = await prepareOpenAIMessages(messageData as any, dryRun);
    return { prompt };
  } finally {
    // Restore original scenario
    if (originalScenario !== null && character) {
      character.scenario = originalScenario;
    }
  }
}
