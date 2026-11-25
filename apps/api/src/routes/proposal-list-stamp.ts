/**
 * The proposals desk orders by the proposal row's updatedAt.
 * A section save and an AI draft write proposal_sections only. Prisma sets
 * @updatedAt on the proposal row itself, not on a child write, so the desk
 * keeps the previous day until something stamps the parent.
 * This payload is that stamp. It does not rename the bid or change its stage.
 */
export function proposalListStamp(now: Date = new Date()): { updatedAt: Date } {
  return { updatedAt: now };
}
