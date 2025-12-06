import { InjectionPrompt } from '@/function/inject';

/**
 * Role types (copied from @sillytavern/script to avoid dependency)
 */
export const extension_prompt_roles = {
  SYSTEM: 0,
  USER: 1,
  ASSISTANT: 2,
} as const;

/**
 * Custom API configuration interface
 */
export type CustomApiConfig = {
  apiurl?: string;
  key?: string;
  model?: string;
  source?: string;
  max_tokens?: number;
  temperature?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  top_p?: number;
};

/**
 * Generation configuration interface (using preset)
 */
export type GenerateConfig = {
  generation_id?: string;
  user_input?: string;
  image?: File | string | (File | string)[];
  should_stream?: boolean;
  overrides?: Overrides;
  injects?: Omit<InjectionPrompt, 'id'>[];
  max_chat_history?: 'all' | number;
  custom_api?: CustomApiConfig;
};

/**
 * Raw generation configuration interface (not using preset)
 */
export type GenerateRawConfig = {
  generation_id?: string;
  user_input?: string;
  image?: File | string | (File | string)[];
  should_stream?: boolean;
  overrides?: Overrides;
  injects?: Omit<InjectionPrompt, 'id'>[];
  ordered_prompts?: (BuiltinPrompt | RolePrompt)[];
  max_chat_history?: 'all' | number;
  custom_api?: CustomApiConfig;
};

/**
 * Role prompt interface
 */
export type RolePrompt = {
  role: 'system' | 'assistant' | 'user';
  content: string;
  image?: File | string | (File | string)[];
};

/**
 * Override configuration interface
 */
export type Overrides = {
  world_info_before?: string; // World book (before character definition)
  persona_description?: string; // User description
  char_description?: string; // Character description
  char_personality?: string; // Character personality
  scenario?: string; // Scenario
  world_info_after?: string; // World book (after character definition)
  dialogue_examples?: string; // Dialogue examples
  chat_history?: {
    with_depth_entries?: boolean;
    author_note?: string;
    prompts?: RolePrompt[];
  };
};

/**
 * Built-in prompt types
 */
export type BuiltinPrompt =
  | 'world_info_before'
  | 'persona_description'
  | 'char_description'
  | 'char_personality'
  | 'scenario'
  | 'world_info_after'
  | 'dialogue_examples'
  | 'chat_history'
  | 'user_input';

/**
 * Default built-in prompt order
 */
export const builtin_prompt_default_order: BuiltinPrompt[] = [
  'world_info_before',
  'persona_description',
  'char_description',
  'char_personality',
  'scenario',
  'world_info_after',
  'dialogue_examples',
  'chat_history',
  'user_input',
];

/**
 * Base data interface
 */
export type BaseData = {
  characterInfo: {
    description: string;
    personality: string;
    persona: string;
    scenario: string;
    system: string;
    jailbreak: string;
  };
  chatContext: {
    oaiMessages: RolePrompt[];
    oaiMessageExamples: string[];
    promptBias: string[];
  };
  worldInfo: {
    worldInfoAfter: Array<string>;
    worldInfoBefore: Array<string>;
    worldInfoDepth: Array<{ entries: string; depth: number; role: number }>;
    worldInfoExamples: Array<string>;
    worldInfoString: Array<string>;
  };
};

/**
 * Detailed configuration namespace
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace detail {
  export type CustomPrompt = {
    role: 'system' | 'user' | 'assistant';
    content: string;
  };

  // Override configuration type
  export type OverrideConfig = {
    world_info_before?: string; // World book (before character definition)
    persona_description?: string; // User description
    char_description?: string; // Character description
    char_personality?: string; // Character advanced definition - personality
    scenario?: string; // Scenario
    world_info_after?: string; // World book (after character definition)
    dialogue_examples?: string; // Character advanced definition - dialogue examples

    with_depth_entries?: boolean; // World book depth
    author_note?: string; // Author's note
    chat_history?: RolePrompt[]; // Chat history
  };

  // Built-in prompt entry type
  export type BuiltinPromptEntry =
    | 'world_info_before' // World book (before character definition)
    | 'persona_description' // User description
    | 'char_description' // Character description
    | 'char_personality' // Character personality
    | 'scenario' // Scenario
    | 'world_info_after' // World book (after character definition)
    | 'dialogue_examples' // Dialogue examples
    | 'chat_history' // Chat history
    | 'user_input'; // User input

  // Generation parameters type
  export type GenerateParams = {
    generation_id?: string;
    user_input?: string;
    use_preset?: boolean;
    image?: File | string | (File | string)[];
    stream?: boolean;
    overrides?: OverrideConfig;
    max_chat_history?: number;
    inject?: Omit<InjectionPrompt, 'id'>[];
    order?: Array<BuiltinPromptEntry | CustomPrompt>;
    custom_api?: CustomApiConfig;
  };
}

/**
 * Role type mapping
 */
export const roleTypes: Record
  'system' | 'user' | 'assistant',
  (typeof extension_prompt_roles)[keyof typeof extension_prompt_roles]
> = {
  system: extension_prompt_roles.SYSTEM,
  user: extension_prompt_roles.USER,
  assistant: extension_prompt_roles.ASSISTANT,
};

/**
 * Default prompt order
 */
export const default_order: detail.BuiltinPromptEntry[] = [
  'world_info_before',
  'persona_description',
  'char_description',
  'char_personality',
  'scenario',
  'world_info_after',
  'dialogue_examples',
  'chat_history',
  'user_input',
];

/**
 * Character names behavior constants
 */
export const character_names_behavior = {
  NONE: -1,
  DEFAULT: 0,
  COMPLETION: 1,
  CONTENT: 2,
};
