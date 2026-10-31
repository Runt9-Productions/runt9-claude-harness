// One prompt the owner typed, with the agent's last message before it, which gives a short reply ("yes") its meaning.
export type OwnerMessage = { text: string; replyingTo?: string }

declare module 'claude-code' {
  interface PluginState {
    'guardrails': { ownerMessages: Shaped<OwnerMessage[]> }
  }
}
