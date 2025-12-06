import { prepareAndOverrideData } from '@/function/generate/dataProcessor';
import { handlePresetPath } from '@/function/generate/generate';
import { handleCustomPath } from '@/function/generate/generateRaw';
import { processUserInputWithImages } from '@/function/generate/inputProcessor';
import { generateResponse } from '@/function/generate/responseGenerator';
import { detail, GenerateConfig, GenerateRawConfig, Overrides } from '@/function/generate/types';
import { setupImageArrayProcessing, unblockGeneration } from '@/function/generate/utils';
import { event_types, eventSource, stopGeneration } from '@sillytavern/script';
import { uuidv4 } from '@sillytavern/scripts/utils';

declare const $: any;

const generationControllers = new Map<string, AbortController>();

/**
 * Abort a specific generation request
 * @param id Generation ID
 */
export function stopGenerationById(id: string) {
  if (generationControllers.has(id)) {
    const controller = generationControllers.get(id);
    controller?.abort(`Generation ID '${id}' has been stopped`);
    generationControllers.delete(id);
    eventSource.emit(event_types.GENERATION_STOPPED, id);
    return true;
  }
  return false;
}

/**
 * Abort all TH-generate generation tasks
 */
export function stopAllGeneration() {
  try {
    for (const [id, controller] of generationControllers.entries()) {
      controller.abort(`Generation ID '${id}' has been stopped`);
      eventSource.emit(event_types.GENERATION_STOPPED, id);
    }
    generationControllers.clear();
    return true;
  } catch (error) {
    console.error(`[TavernHelper][Generate:Stop] Error aborting all generation tasks: ${error}`);
    return false;
  }
}

/**
 * Clean up image processing related listeners and Promises
 */
function cleanupImageProcessing(imageProcessingSetup?: ReturnType<typeof setupImageArrayProcessing>): void {
  if (imageProcessingSetup) {
    try {
      imageProcessingSetup.cleanup();
      imageProcessingSetup.rejectImageProcessing(new Error('Generation stopped'));
    } catch (error) {
      console.warn(`[TavernHelper][Generate:Stop] Error cleaning up image processing: ${error}`);
    }
  }
}

/**
 * Convert from Overrides to detail.OverrideConfig
 * @param overrides Override configuration
 * @returns detail.OverrideConfig
 */
export function fromOverrides(overrides: Overrides): detail.OverrideConfig {
  return {
    world_info_before: overrides.world_info_before,
    persona_description: overrides.persona_description,
    char_description: overrides.char_description,
    char_personality: overrides.char_personality,
    scenario: overrides.scenario,
    world_info_after: overrides.world_info_after,
    dialogue_examples: overrides.dialogue_examples,

    with_depth_entries: overrides.chat_history?.with_depth_entries,
    author_note: overrides.chat_history?.author_note,
    chat_history: overrides.chat_history?.prompts,
  };
}

/**
 * Convert from GenerateConfig to detail.GenerateParams
 * @param config Generation configuration
 * @returns detail.GenerateParams
 */
export function fromGenerateConfig(config: GenerateConfig): detail.GenerateParams {
  return {
    generation_id: config.generation_id,
    user_input: config.user_input,
    use_preset: true,
    image: config.image,
    stream: config.should_stream ?? false,
    overrides: config.overrides !== undefined ? fromOverrides(config.overrides) : undefined,
    inject: config.injects,
    max_chat_history: typeof config.max_chat_history === 'number' ? config.max_chat_history : undefined,
    custom_api: config.custom_api,
  };
}

/**
 * Convert from GenerateRawConfig to detail.GenerateParams
 * @param config Raw generation configuration
 * @returns detail.GenerateParams
 */
export function fromGenerateRawConfig(config: GenerateRawConfig): detail.GenerateParams {
  return {
    generation_id: config.generation_id,
    user_input: config.user_input,
    use_preset: false,
    image: config.image,
    stream: config.should_stream ?? false,
    max_chat_history: typeof config.max_chat_history === 'number' ? config.max_chat_history : undefined,
    overrides: config.overrides ? fromOverrides(config.overrides) : undefined,
    inject: config.injects,
    order: config.ordered_prompts,
    custom_api: config.custom_api,
  };
}

/**
 * Core function for generating AI responses
 * @param config Generation configuration parameters
 * @param config.user_input User input text
 * @param config.use_preset Whether to use preset
 * @param config.image Image parameter, can be a single image (File|string) or image array (File|string)[]
 * @param config.overrides Override configuration
 * @param config.max_chat_history Maximum chat history count
 * @param config.inject Injected prompts
 * @param config.order Prompt order
 * @param config.stream Whether to enable streaming
 * @returns Promise<string> Generated response text
 */
async function iframeGenerate({
  generation_id,
  user_input = '',
  use_preset = true,
  image = undefined,
  overrides = undefined,
  max_chat_history = undefined,
  inject = [],
  order = undefined,
  stream = false,
  custom_api = undefined,
}: detail.GenerateParams = {}): Promise<string> {
  const generationId = generation_id || uuidv4();
  const abortController = new AbortController();
  generationControllers.set(generationId, abortController);
  let imageProcessingSetup: ReturnType<typeof setupImageArrayProcessing> | undefined = undefined;

  try {
    // 1. Process user input and images (regex, macros, image array)
    const inputResult = await processUserInputWithImages(user_input, use_preset, image);
    const { processedUserInput, processedImageArray } = inputResult;
    imageProcessingSetup = inputResult.imageProcessingSetup;

    await eventSource.emit(event_types.GENERATION_AFTER_COMMANDS, 'normal', {}, false);

    // 2. Prepare filtered base data
    const baseData = await prepareAndOverrideData(
      {
        overrides,
        max_chat_history,
        inject,
        order,
      },
      processedUserInput,
    );

    // 3. Branch processing based on use_preset
    const generate_data = use_preset
      ? await handlePresetPath(baseData, processedUserInput, {
          image,
          overrides,
          max_chat_history,
          inject,
          order,
        })
      : await handleCustomPath(
          baseData,
          {
            image,
            overrides,
            max_chat_history,
            inject,
            order,
            processedImageArray,
          },
          processedUserInput,
        );

    await eventSource.emit(event_types.GENERATE_AFTER_DATA, generate_data);
    // 4. Decide generation method based on stream parameter
    const result = await generateResponse(
      generate_data,
      stream,
      generationId,
      imageProcessingSetup,
      abortController,
      custom_api,
    );

    return result;
  } catch (error) {
    if (imageProcessingSetup) {
      imageProcessingSetup.rejectImageProcessing(error);
    }
    throw error;
  } finally {
    // Cleanup
    cleanupImageProcessing(imageProcessingSetup);
    generationControllers.delete(generationId);
    // If all generations have ended, unlock UI
    if (generationControllers.size === 0) {
      unblockGeneration();
    }
  }
}

export async function generate(config: GenerateConfig) {
  const converted_config = fromGenerateConfig(config);
  return await iframeGenerate(converted_config);
}

export async function generateRaw(config: GenerateRawConfig) {
  const converted_config = fromGenerateRawConfig(config);
  return await iframeGenerate(converted_config);
}

/**
 * Logic when stop button is clicked
 */
$(document).on('click', '#mes_stop', function () {
  const wasStopped = stopGeneration();
  if (wasStopped) {
    for (const [, controller] of generationControllers.entries()) {
      controller.abort('Clicked stop button');
    }
    generationControllers.clear();
    unblockGeneration();
  }
});
