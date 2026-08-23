// Injected everywhere else in domain/ — nothing outside this file calls Date.now() directly
// (Constitution III).
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
