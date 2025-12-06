import { CustomApiConfig } from '@/function/generate/types';
import {
  clearInjectionPrompts,
  extractMessageFromData,
  setupImageArrayProcessing,
  unblockGeneration,
} from '@/function/generate/utils';
import { saveChatConditionalDebounced } from '@/util/tavern';
import {
  cleanUpMessage,
  countOccurrences,
  deactivateSendButtons,
  eventSource,
  event_types,
  isOdd,
  saveSettingsDebounced,
} from '@sillytavern/script';
import { oai_settings, sendOpenAIRequest } from '@sillytavern/scripts/openai';
import { power_user } from '@sillytavern/scripts/power-user';
import { Stopwatch, uuidv4 } from '@sillytavern/scripts/utils';

/**
 * Streaming processor class
 * Handles streaming generation response data
 */
class StreamingProcessor {
  public generator: () => AsyncGenerator<{ text: string }, void, void>;
  public stoppingStrings?: any;
  public result: string;
  public isStopped: boolean;
  public isFinished: boolean;
  public abortController: AbortController;
  private messageBuffer: string;
  private generationId: string;

  constructor(generationId: string, abortController: AbortController) {
    this.result = '';
    this.messageBuffer = '';
    this.isStopped = false;
    this.isFinished = false;
    this.generator = this.nullStreamingGeneration;
    this.abortController = abortController;
    this.generationId = generationId;
  }

  onProgressStreaming(data: { text: string; isFinal: boolean }) {
    // Calculate incremental text
    const newText = data.text.slice(this.messageBuffer.length);
    this.messageBuffer = data.text;
    // @ts-expect-error Compatible with older SillyTavern versions
    let processedText = cleanUpMessage(newText, false, false, !data.isFinal, this.stoppingStrings);

    const charsToBalance = ['*', '"', '```'];
    for (const char of charsToBalance) {
      if (!data.isFinal && isOdd(countOccurrences(processedText, char))) {
        const separator = char.length > 1 ? '\n' : '';
        processedText = processedText.trimEnd() + separator + char;
      }
    }

    eventSource.emit('js_stream_token_received_fully', data.text, this.generationId);
    eventSource.emit('js_stream_token_received_incrementally', processedText, this.generationId);

    if (data.isFinal) {
      // @ts-expect-error Compatible with older SillyTavern versions
      const message = cleanUpMessage(data.text, false, false, false, this.stoppingStrings);
      eventSource.emit('js_generation_before_end', { message }, this.generationId);
      eventSource.emit('js_generation_ended', message, this.generationId);
      data.text = message;
    }
  }

  onErrorStreaming() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.isStopped = true;
    unblockGeneration();
    saveChatConditionalDebounced();
  }

  // eslint-disable-next-line require-yield
  async *nullStreamingGeneration(): AsyncGenerator<{ text: string }, void, void> {
    throw Error('Generation function for streaming is not hooked up');
  }

  async generate() {
    try {
      const sw = new Stopwatch(1000 / power_user.streaming_fps);

      for await (const { text } of this.generator()) {
        if (this.isStopped) {
          this.messageBuffer = '';
          return;
        }

        this.result = text;
        await sw.tick(() => this.onProgressStreaming({ text: this.result, isFinal: false }));
      }

      if (!this.isStopped) {
        this.onProgressStreaming({ text: this.result, isFinal: true });
      } else {
        this.messageBuffer = '';
      }
    } catch (err) {
      if (!this.isFinished) {
        this.onErrorStreaming();
        throw Error(`Generate method error: ${err}`);
      }
      this.messageBuffer = '';
      return this.result;
    }

    this.isFinished = true;
    return this.result;
  }
}

/**
 * Handle non-streaming response
 * @param response API response object
 * @returns Extracted message text
 */
async function handleResponse(response: any, generationId: string) {
  if (!response) {
    throw Error(`No response received`);
  }
  if (response.error) {
    if (response?.response) {
      toastr.error(response.response, t`API Error`, {
        preventDuplicates: true,
      });
    }
    throw Error(response?.response);
  }
  const result = { message: extractMessageFromData(response) };
  eventSource.emit('js_generation_before_end', result, generationId);
  eventSource.emit('js_generation_ended', result.message, generationId);
  return result.message;
}

/**
 * Generate response
 * @param generate_data Generation data
 * @param useStream Whether to use streaming
 * @param generationId Generation ID
 * @param imageProcessingSetup Image array processing setup, containing Promise and resolver
 * @param abortController Abort controller
 * @param customApi Custom API configuration
 * @returns Generated response text
 */
export async function generateResponse(
  generate_data: any,
  useStream = false,
  generationId: string | undefined = undefined,
  imageProcessingSetup: ReturnType<typeof setupImageArrayProcessing> | undefined = undefined,
  abortController: AbortController,
  customApi?: CustomApiConfig,
): Promise<string> {
  let result = '';
  let customApiEventHandler: ((data: any) => void) | null = null;

  try {
    deactivateSendButtons();

    // If there's custom API configuration, set up one-time event interception
    if (customApi?.apiurl) {
      customApiEventHandler = (data: any) => {
        data.reverse_proxy = customApi.apiurl;
        data.chat_completion_source = customApi.source || 'openai';
        data.proxy_password = customApi.key || '';
        data.model = customApi.model;
        if (customApi.max_tokens !== undefined) {
          data.max_tokens = customApi.max_tokens;
        }
        if (customApi.temperature !== undefined) {
          data.temperature = customApi.temperature;
        }
        if (customApi.frequency_penalty !== undefined) {
          data.frequency_penalty = customApi.frequency_penalty;
        }
        if (customApi.presence_penalty !== undefined) {
          data.presence_penalty = customApi.presence_penalty;
        }
        if (customApi.top_p) {
          data.top_p = customApi.top_p;
        }
        console.info(data);

        return data;
      };

      eventSource.once(event_types.CHAT_COMPLETION_SETTINGS_READY, customApiEventHandler);
    }

    // If there's image processing, wait for image processing to complete
    if (imageProcessingSetup) {
      try {
        await imageProcessingSetup.imageProcessingPromise;
      } catch (imageError: any) {
        // Image processing failure should not block the entire generation flow, but needs to log the error
        throw new Error(`Image processing failed: ${imageError?.message || 'Unknown error'}`);
      }
    }
    if (generationId === undefined || generationId === '') {
      generationId = uuidv4();
    }
    eventSource.emit('js_generation_started', generationId);
    if (useStream) {
      const originalStreamSetting = oai_settings.stream_openai;
      if (!originalStreamSetting) {
        oai_settings.stream_openai = true;
        saveSettingsDebounced();
      }
      const streamingProcessor = new StreamingProcessor(generationId, abortController);
      // @ts-expect-error Type is correct
      streamingProcessor.generator = await sendOpenAIRequest('normal', generate_data.prompt, abortController.signal);
      result = (await streamingProcessor.generate()) as string;
      if (originalStreamSetting !== oai_settings.stream_openai) {
        oai_settings.stream_openai = originalStreamSetting;
        saveSettingsDebounced();
      }
    } else {
      const should_stream = oai_settings.stream_openai;
      oai_settings.stream_openai = false;
      const response = await sendOpenAIRequest('normal', generate_data.prompt, abortController.signal);
      oai_settings.stream_openai = should_stream;
      result = await handleResponse(response, generationId);
    }
  } catch (error) {
    // If there's image processing setup but generation failed, ensure Promise is rejected
    if (imageProcessingSetup) {
      imageProcessingSetup.rejectImageProcessing(error);
    }
    throw error;
  } finally {
    // Clean up custom API event listener
    if (customApiEventHandler) {
      eventSource.removeListener(event_types.CHAT_COMPLETION_SETTINGS_READY, customApiEventHandler);
    }

    //unblockGeneration();
    await clearInjectionPrompts(['INJECTION']);
  }
  return result;
}
