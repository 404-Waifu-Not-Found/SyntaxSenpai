declare module '@proj-airi/server-sdk-shared' {
  // Minimal types mirroring compiled dist/index.d.mts to satisfy server typecheck.
  export interface WireMessage {
    id: string
    chatId: string
    senderId: string | null
    role: 'system' | 'user' | 'assistant' | 'tool' | 'error'
    content: string
    seq: number
    createdAt: number
    updatedAt: number
  }
  export type MessageRole = WireMessage['role']

  export interface SendMessagesRequest {
    chatId: string
    messages: { id: string; role: string; content: string }[]
  }
  export interface SendMessagesResponse { seq: number }

  export interface PullMessagesRequest { chatId: string; afterSeq: number; limit?: number }
  export interface PullMessagesResponse { messages: WireMessage[]; seq: number }

  export interface NewMessagesPayload { chatId: string; messages: WireMessage[]; fromSeq: number; toSeq: number }

  // Keep event shapes `any` to avoid pulling in @moeru/eventa types here.
  export const sendMessages: any
  export const pullMessages: any
  export const newMessages: any

  export default {} as any
}
