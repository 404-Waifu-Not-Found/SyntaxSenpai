import type { WebSocketEventOptionalSource } from '@proj-airi/server-sdk'

// Use a loose event typing here to avoid tightly coupling this integration
// to the entire protocol event map. ServerClient expects a ProtocolEvents-style
// mapping; passing `any` keeps the runtime behavior while avoiding complex
// generic constraints during workspace typecheck.
type Events = any

import { useLogger } from '@guiiai/logg'
import { ContextUpdateStrategy, Client as ServerClient } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

export class Client {
  private client: ServerClient<Events> | null = null

  async connect(): Promise<boolean> {
    try {
      this.client = new ServerClient<Events>({ name: 'proj-airi:plugin-vscode' })
      await this.client.connect()
      useLogger().log('AIRI connected to Server Channel')
      return true
    }
    catch (error) {
      useLogger().errorWithError('Failed to connect to AIRI Server Channel:', error)
      return false
    }
  }

  disconnect(): void {
    if (this.client) {
      this.client.close()
      this.client = null
      useLogger().log('AIRI disconnected')
    }
  }

  private async send(event: any): Promise<void> {
    if (!this.client) {
      useLogger().warn('Cannot send event: not connected to AIRI Server Channel')
      return
    }

    try {
      await this.client.connect()
      // Bypass strict server-sdk generics here to avoid workspace-wide type coupling
      ;(this.client as any).send(event)
    }
    catch (error) {
      useLogger().errorWithError('Failed to send event to AIRI:', error)
    }
  }

  async replaceContext(context: string): Promise<void> {
    const id = nanoid()
    this.send({ type: 'context:update', data: { strategy: ContextUpdateStrategy.ReplaceSelf, text: context, id, contextId: id } })
  }

  async appendContext(context: string): Promise<void> {
    const id = nanoid()
    this.send({ type: 'context:update', data: { strategy: ContextUpdateStrategy.AppendSelf, text: context, id, contextId: id } })
  }

  isConnected(): boolean {
    return !!this.client
  }
}
