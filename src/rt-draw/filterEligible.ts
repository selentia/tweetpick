const DRAW_MODES = Object.freeze({
  RT: 'rt',
  RT_FOLLOW: 'rt-follow',
});

type DrawMode = (typeof DRAW_MODES)[keyof typeof DRAW_MODES];

interface FollowParticipant {
  followedByAuth?: boolean | null;
}

interface FilterEligibleResult<TParticipant> {
  eligible: TParticipant[];
  rejected: TParticipant[];
}

function filterEligible<TParticipant extends FollowParticipant>(
  participants: TParticipant[],
  mode: DrawMode = DRAW_MODES.RT
): FilterEligibleResult<TParticipant> {
  if (!Array.isArray(participants)) {
    throw new Error('participants must be an array.');
  }

  if (mode === DRAW_MODES.RT) {
    return {
      eligible: participants.slice(),
      rejected: [],
    };
  }

  if (mode === DRAW_MODES.RT_FOLLOW) {
    const eligible: TParticipant[] = [];
    const rejected: TParticipant[] = [];

    for (const participant of participants) {
      if (participant && participant.followedByAuth === true) {
        eligible.push(participant);
      } else {
        rejected.push(participant);
      }
    }

    return {
      eligible,
      rejected,
    };
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

export { DRAW_MODES, filterEligible };
