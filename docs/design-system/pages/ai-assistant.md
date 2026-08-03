# AI Assistant Page — Design Overrides

**Route:** `/ai` (or embedded as drawer)
**Component:** AI assistant surfaces

## Unique layout
- Chat interface: message thread (fluid) + input bar (sticky bottom)
- Message bubbles: user right-aligned (brand tint), assistant left-aligned (surface-card)
- Citations/sources: collapsible section below each AI response
- Thinking indicator: animated 3-dot pulse while response streams

## Component overrides
- AI message: --info-tint background, left border 3px --info, clearly differentiated from human
- User message: --brand-primary-tint background, right-aligned, max-width 75%
- Input bar: multi-line Input, auto-grows up to 4 lines, then scrolls
- Source chips: --tag-purple-bg/fg for AI-sourced citations

## Motion
- Message appearance: fadeUp with springSmooth, 300ms
- Streaming text: no animation — renders as fast as tokens arrive
- Thinking dots: CSS keyframe, 3-dot stagger, 1.2s cycle, respects prefers-reduced-motion
- Source expansion: height animate via AnimatePresence (transform only — use max-height trick with overflow hidden)

## Dark mode specifics
- AI message: rgba(129,140,248,0.08) background, rgba(129,140,248,0.3) left border
- User message: rgba(94,106,210,0.12) background
- Input bar: --surface-sunken background, focus ring as normal
