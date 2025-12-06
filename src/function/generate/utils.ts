import { saveChatConditionalDebounced } from '@/util/tavern';
import {
  activateSendButtons,
  eventSource,
  extension_prompt_roles,
  extension_prompt_types,
  setExtensionPrompt,
  setGenerationProgress,
  showSwipeButtons,
} from '@sillytavern/script';
import { getContext } from '@sillytavern/scripts/extensions';
import { getRegexedString, regex_placement } from '@sillytavern/scripts/extensions/regex/engine';
import { oai_settings } from '@sillytavern/scripts/openai';
import { flushEphemeralStoppingStrings } from '@sillytavern/scripts/power-user';
import { getBase64Async, isDataURL } from '@sillytavern/scripts/utils';

/**
 * Convert file to base64
 * @param img File or image URL
 * @returns Base64 string
 */
export async function convertFileToBase64(img: File | string): Promise<string | undefined> {
  const isDataUrl = typeof img === 'string' && isDataURL(img);
  let processedImg;

  if (!isDataUrl) {
    try {
      if (typeof img === 'string') {
        const response = await fetch(img, { method: 'GET', cache: 'force-cache' });
        if (!response.ok) throw new Error('Failed to fetch image');
        const blob = await response.blob();
        processedImg = await getBase64Async(blob);
      } else {
        processedImg = await getBase64Async(img);
      }
    } catch (err) {
      return undefined;
    }
  } else {
    processedImg = img
  }
  return processedImg;
}

/**
 * Extract message content from response data
 * @param data Response data
 * @returns Extracted message string
 */
export function extractMessageFromData(data: any): string {
  if (typeof data === 'string') {
    return data;
  }

  return (
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    data?.text ??
    data?.message?.content?.[0]?.text ??
    data?.message?.tool_plan ??
    ''
  );
}

/**
 * Parse dialogue examples format
 * @param examplesStr Dialogue examples string
 * @returns Processed dialogue examples array
 */
export function parseMesExamples(examplesStr: string): string[] {
  if (examplesStr.length === 0 || examplesStr === '<START>') {
    return [];
  }

  if (!examplesStr.startsWith('<START>')) {
    examplesStr = '<START>\n' + examplesStr.trim();
  }
  const blockHeading = '<START>\n';
  const splitExamples = examplesStr
    .split(/<START>/gi)
    .slice(1)
    .map(block => `${blockHeading}${block.trim()}\n`);

  return splitExamples;
}

/**
 * Process user input with regex first
 * @param user_input User input
 * @returns Processed user input
 */
export function processUserInput(user_input: string): string {
  if (user_input === '') {
    user_input = oai_settings.send_if_empty.trim();
  }
  return getRegexedString(user_input, regex_placement.USER_INPUT, {
    isPrompt: true,
    depth: 0,
  });
}

/**
 * Get prompt role type
 * @param role Role number
 * @returns Role string
 */
export function getPromptRole(role: number): 'system' | 'user' | 'assistant' {
  switch (role) {
    case extension_prompt_roles.SYSTEM:
      return 'system';
    case extension_prompt_roles.USER:
      return 'user';
    case extension_prompt_roles.ASSISTANT:
      return 'assistant';
    default:
      return 'system';
  }
}

/**
 * Check if prompt is filtered
 * @param promptId Prompt ID
 * @param config Configuration object
 * @returns Whether it is filtered
 */
export function isPromptFiltered(promptId: string, config: { overrides?: any }): boolean {
  if (!config.overrides) {
    return false;
  }

  if (promptId === 'with_depth_entries') {
    return config.overrides.with_depth_entries === false;
  }

  // Special handling for chat_history
  if (promptId === 'chat_history') {
    const prompts = config.overrides.chat_history;
    return prompts !== undefined && prompts.length === 0;
  }

  // For regular prompts, only filtered when it exists in overrides and is an empty string
  const override = config.overrides[promptId as keyof any];
  return override !== undefined && override === '';
}

/**
 * Add temporary user message
 * @param userContent User content
 */
export function addTemporaryUserMessage(userContent: string): void {
  setExtensionPrompt('TEMP_USER_MESSAGE', userContent, extension_prompt_types.IN_PROMPT, 0, true, 1);
}

/**
 * Remove temporary user message
 */
export function removeTemporaryUserMessage(): void {
  setExtensionPrompt('TEMP_USER_MESSAGE', '', extension_prompt_types.IN_PROMPT, 0, true, 1);
}

/**
 * Unblock generation state
 */
export function unblockGeneration(): void {
  activateSendButtons();
  showSwipeButtons();
  setGenerationProgress(0);
  flushEphemeralStoppingStrings();
}

/**
 * Clear injection prompts
 * @param prefixes Array of prefixes
 */
export async function clearInjectionPrompts(prefixes: string[]): Promise<void> {
  const prompts: Record<string, any> = getContext().extensionPrompts;
  Object.keys(prompts)
    .filter(key => prefixes.some(prefix => key.startsWith(prefix)))
    .forEach(key => delete prompts[key]);
  saveChatConditionalDebounced();
}

/**
 * Directly process image array, convert to prompt format
 * @param processedUserInput Processed user input
 * @param image Image array parameter
 * @returns Array format containing text and image content
 */
export async function processImageArrayDirectly(
  processedUserInput: string,
  image: (File | string)[],
): Promise<{ type: string; text?: string; image_url?: { url: string; detail: string } }[]> {
  const quality = oai_settings.inline_image_quality || 'low';

  const imageContents = await Promise.all(
    image.map(async img => {
      try {
        const processedImg = await convertFileToBase64(img);
        if (!processedImg) {
          console.warn('[TavernHelper][Generate:ImageArrayProcessing] Image processing failed, skipping this image');
          return null;
        }
        return {
          type: 'image_url',
          image_url: { url: processedImg, detail: quality },
        };
      } catch (imgError) {
        console.warn('[TavernHelper][Generate:ImageArrayProcessing] Image processing failed, skipping this image');
        return null;
      }
    }),
  );

  const validImageContents = imageContents.filter(content => content !== null);
  const textContent = {
    type: 'text',
    text: processedUserInput,
  };

  return [textContent, ...validImageContents];
}

/**
 * Set up image array processing logic (for event listener method)
 * @param processedUserInput Processed user input
 * @param image Image array parameter
 * @returns Object containing user input with marker and Promise resolver
 */
export function setupImageArrayProcessing(
  processedUserInput: string,
  image: (File | string)[],
): {
  userInputWithMarker: string;
  imageProcessingPromise: Promise<void>;
  resolveImageProcessing: () => void;
  rejectImageProcessing: (reason?: any) => void;
  cleanup: () => void;
} {
  const imageMarker = `__IMG_ARRAY_MARKER_`;
  const userInputWithMarker = processedUserInput + imageMarker;

  let resolveImageProcessing: () => void;
  let rejectImageProcessing: (reason?: any) => void;

  const imageProcessingPromise = new Promise<void>((resolve, reject) => {
    resolveImageProcessing = resolve;
    rejectImageProcessing = reject;
  });

  let timeoutId: NodeJS.Timeout | null = null;
  let isHandlerRegistered = true;

  const imageArrayHandler = async (eventData: { chat: { role: string; content: string | any[] }[] }) => {
    try {
      // Add timeout protection
      timeoutId = setTimeout(() => {
        console.warn('[TavernHelper][Generate:ImageArrayProcessing] Image processing timeout');
        rejectImageProcessing(new Error('Image processing timeout'));
      }, 30000);

      for (let i = eventData.chat.length - 1; i >= 0; i--) {
        const message = eventData.chat[i];
        const contentStr = typeof message.content === 'string' ? message.content : '';

        if (message.role === 'user' && contentStr.includes(imageMarker)) {
          try {
            const quality = oai_settings.inline_image_quality || 'low';

            const imageContents = await Promise.all(
              image.map(async img => {
                try {
                  const processedImg = await convertFileToBase64(img);
                  if (!processedImg) {
                    console.warn('[TavernHelper][Generate:ImageArrayProcessing] Image processing failed, skipping this image');
                    return null;
                  }
                  return {
                    type: 'image_url',
                    image_url: { url: processedImg, detail: quality },
                  };
                } catch (imgError) {
                  console.warn('[TavernHelper][Generate:ImageArrayProcessing] Single image processing failed:', imgError);
                  return null;
                }
              }),
            );

            const validImageContents = imageContents.filter(content => content !== null);
            const cleanContent = contentStr.replace(imageMarker, '');
            const textContent = {
              type: 'text',
              text: cleanContent,
            };

            message.content = [textContent, ...validImageContents] as any;

            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            resolveImageProcessing();
            return;
          } catch (error) {
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            console.error('[TavernHelper][Generate:ImageArrayProcessing] Error processing images:', error);
            rejectImageProcessing(error);
            return;
          }
        }
      }

      console.warn('[TavernHelper][Generate:ImageArrayProcessing] User message containing image marker not found');
      resolveImageProcessing();
    } catch (error) {
      console.error('[TavernHelper][Generate:ImageArrayProcessing] imageArrayHandler exception:', error);
      rejectImageProcessing(error);
    }
  };

  eventSource.once('chat_completion_prompt_ready', imageArrayHandler);

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (isHandlerRegistered) {
      try {
        eventSource.removeListener('chat_completion_prompt_ready', imageArrayHandler);
        isHandlerRegistered = false;
      } catch (error) {
        console.warn('[TavernHelper][Generate:ImageArrayProcessing] Error cleaning up event listener:', error);
      }
    }
  };

  return {
    userInputWithMarker,
    imageProcessingPromise,
    resolveImageProcessing: resolveImageProcessing!,
    rejectImageProcessing: rejectImageProcessing!,
    cleanup,
  };
}
