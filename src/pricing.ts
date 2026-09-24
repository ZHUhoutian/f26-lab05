import type { Room } from './types';

const PREMIUM_MULTIPLIER = 1.15;
const LONG_BOOKING_MINUTES = 180;
const LONG_BOOKING_MULTIPLIER = 0.9;
const EVENING_START_MINUTE = 17 * 60;
const EVENING_MULTIPLIER = 0.95;

/** Price in cents for holding a room between two minute marks. */
export function priceFor(room: Room, start: number, end: number): number {
  const minutes = end - start;
  let cents = Math.round((minutes / 60) * room.hourlyRateCents);
  if (room.premium === true) {
    cents = Math.round(cents * PREMIUM_MULTIPLIER);
  }
  return applyDiscounts(cents, start, minutes);
}

function applyDiscounts(cents: number, start: number, minutes: number): number {
  let discounted = cents;
  if (minutes >= LONG_BOOKING_MINUTES) {
    discounted = Math.round(discounted * LONG_BOOKING_MULTIPLIER);
  }
  if (start >= EVENING_START_MINUTE) {
    discounted = Math.round(discounted * EVENING_MULTIPLIER);
  }
  return discounted;
}
