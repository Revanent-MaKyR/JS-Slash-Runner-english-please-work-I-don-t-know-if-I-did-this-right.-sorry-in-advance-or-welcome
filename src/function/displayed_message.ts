import { chat, messageFormatting } from '@sillytavern/script';
import { getLastMessageId } from '@sillytavern/scripts/macros';

type FormatAsDisplayedMessageOption = {
  message_id?: 'last' | 'last_user' | 'last_char' | number;
};

export function formatAsDisplayedMessage(
  text: string,
  { message_id = 'last' }: FormatAsDisplayedMessageOption = {},
): string {
  if (typeof message_id !== 'number' && !['last', 'last_user', 'last_char'].includes(message_id)) {
    throw Error(
      `Invalid message_id provided, please provide 'last', 'last_user', 'last_char' or a message floor number, you provided: ${message_id}`,
    );
  }

  const last_message_id = getLastMessageId();
  if (last_message_id === null) {
    throw Error(`No message floor found, you provided: ${message_id}`);
  }

  switch (message_id) {
    case 'last':
      message_id = last_message_id;
      break;
    case 'last_user': {
      const last_user_message_id = getLastMessageId({ filter: (m: any) => m.is_user && !m.is_system }) as number;
      if (last_user_message_id === null) {
        throw Error(`No user message floor found, you provided: ${message_id}`);
      }
      message_id = last_user_message_id;
      break;
    }
    case 'last_char': {
      const last_char_message_id = getLastMessageId({ filter: (m: any) => !m.is_user && !m.is_system }) as number;
      if (last_char_message_id === null) {
        throw Error(`No char message floor found, you provided: ${message_id}`);
      }
      message_id = last_char_message_id;
      break;
    }
  }

  if (message_id < 0 || message_id > last_message_id) {
    throw Error(`Provided message_id is not within [0, ${last_message_id}], you provided: ${message_id}`);
  }

  const chat_message = chat[message_id];
  const result = messageFormatting(text, chat_message.name, chat_message.is_system, chat_message.is_user, message_id);
  return result;
}

export function retrieveDisplayedMessage(message_id: number): JQuery<HTMLDivElement> {
  return $(`#chat > .mes[mesid = "${message_id}"]`, window.parent.document).find(`div.mes_text`);
}
