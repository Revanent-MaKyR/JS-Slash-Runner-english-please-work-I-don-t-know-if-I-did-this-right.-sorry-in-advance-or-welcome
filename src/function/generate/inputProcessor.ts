import { substituteParams } from '@sillytavern/script';
import { processImageArrayDirectly, processUserInput, setupImageArrayProcessing } from '@/function/generate/utils';

/**
 * User input processing result interface
 */
export interface ProcessedInputResult {
  processedUserInput: string;
  imageProcessingSetup?: ReturnType<typeof setupImageArrayProcessing>;
  processedImageArray?: { type: string; text?: string; image_url?: { url: string; detail: string } }[];
}

/**
 * First step of processing user input
 * Includes preprocessing operations like macro substitution, regex processing, etc.
 * @param user_input Original user input
 * @returns Processed user input
 */
export function processInitialUserInput(user_input = ''): string {
  // 1. Process macro substitution
  const substitutedInput = substituteParams(user_input);
  // 2. Process regex and other preprocessing
  const processedUserInput = processUserInput(substitutedInput) || '';
  return processedUserInput;
}

/**
 * Complete user input and image processing
 * Includes user input preprocessing and image array processing logic
 * @param user_input User input text
 * @param use_preset Whether to use preset
 * @param image Image parameter, can be a single image (File|string) or image array (File|string)[]
 * @returns Processing result, containing processed user input and image processing related data
 */
export async function processUserInputWithImages(
  user_input = '',
  use_preset = true,
  image: File | string | (File | string)[] | undefined = undefined,
): Promise<ProcessedInputResult> {
  // 1. Process user input (regex, macros)
  let processedUserInput = processInitialUserInput(user_input);

  // Handle possible image array case
  let imageProcessingSetup: ReturnType<typeof setupImageArrayProcessing> | undefined = undefined;
  let processedImageArray: { type: string; text?: string; image_url?: { url: string; detail: string } }[] | undefined =
    undefined;

  if (Array.isArray(image) && image.length > 0) {
    if (use_preset) {
      // When using preset, use event listener method to process image array
      imageProcessingSetup = setupImageArrayProcessing(processedUserInput, image);
      processedUserInput = imageProcessingSetup.userInputWithMarker;
    } else {
      // When using raw mode, directly process image array
      processedImageArray = await processImageArrayDirectly(processedUserInput, image);
      // Keep original user input unchanged, image array will be used directly in subsequent steps
    }
  }

  return {
    processedUserInput,
    imageProcessingSetup,
    processedImageArray,
  };
}
