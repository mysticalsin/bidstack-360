// The RFP crew roster now lives in @bidstack/shared so the board (display) and
// the worker (live stage prompts) read ONE source of truth — roles, goals,
// instructions, and skills never drift between the visual layer and execution.
// This module re-exports it for the web components that import from './rfpCrew'.

export {
  CREW_STAGES,
  RFP_CREW,
  OVERSIGHT_CREW,
  WORKING_CREW,
  crewMemberByKey,
  buildRolePreamble,
  rolePreambleForKey,
  type CrewStage,
  type CrewStation,
  type RfpCrewMember,
} from '@bidstack/shared';
