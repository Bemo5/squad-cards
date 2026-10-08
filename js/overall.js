// Overall rating and tier. Pure functions over the deck config.

// Weighted average of the deck's stats. A role can weight stats differently
// (a "Chef" leans on CHF). Inverted stats count as 100 - value, so a high
// LAT (lateness) drags the overall down while the card still shows the raw 90.
export function overall(p, deck) {
  if (Number.isFinite(p.ovrOverride)) return p.ovrOverride;
  const stats = deck.stats || [];
  if (!stats.length) return 0;
  const role = (deck.roles || []).find(r => r.code === p.role);
  let sum = 0, wsum = 0;
  for (const st of stats) {
    const w = Number(role?.weights?.[st.key] ?? 1);
    if (!(w > 0)) continue;
    let v = Number(p.stats?.[st.key] ?? 50);
    if (st.invert) v = 100 - v;
    sum += v * w; wsum += w;
  }
  return wsum ? Math.max(1, Math.min(99, Math.round(sum / wsum))) : 0;
}

// Tiers are {name, min, skin}. Highest min the overall clears wins. A player's
// own skin (e.g. a hand-picked TOTY) beats the tier.
export function tierFor(ovr, deck) {
  const tiers = [...(deck.tiers || [])].sort((a, b) => b.min - a.min);
  return tiers.find(t => ovr >= t.min) || tiers[tiers.length - 1] || { name: 'Gold', skin: 'gold' };
}

export function skinFor(p, deck, ovr = overall(p, deck)) {
  return p.skin || tierFor(ovr, deck).skin;
}

export const clampStat = v => Math.max(1, Math.min(99, Math.round(Number(v) || 1)));

// Starting point for a new deck. Everything here is editable in Manage.
export function deckTemplate(year) {
  return {
    year,
    crest: String(year).slice(-2),
    flag: 'eg',
    revealed: false,
    stats: [
      { key: 'BAN', name: 'Banter' },
      { key: 'LAT', name: 'Lateness', invert: true },
      { key: 'RIZ', name: 'Rizz' },
      { key: 'LOY', name: 'Loyalty' },
      { key: 'REP', name: 'Replies in the group chat' },
      { key: 'CHF', name: 'Cooking' },
    ],
    roles: [
      { code: 'CAP', name: 'Captain', weights: { LOY: 2, BAN: 1, LAT: 1, RIZ: 1, REP: 1, CHF: 1 } },
      { code: 'DRV', name: 'Driver', weights: { LAT: 2, LOY: 1, BAN: 1, RIZ: 1, REP: 1, CHF: 1 } },
      { code: 'CHF', name: 'Chef', weights: { CHF: 3, BAN: 1, LAT: 1, RIZ: 1, LOY: 1, REP: 1 } },
      { code: 'CLN', name: 'Clown', weights: { BAN: 3, LAT: 1, RIZ: 1, LOY: 1, REP: 1, CHF: 1 } },
    ],
    tiers: [
      { name: 'Gold', min: 75, skin: 'gold' },
      { name: 'Silver', min: 65, skin: 'silver' },
      { name: 'Bronze', min: 0, skin: 'bronze' },
    ],
    lives: 5,
  };
}

// Lives. Each card starts with deck.lives (0 turns the feature off). A life
// goes when a vote passes: more than half of the eligible voters say "take
// it". The card's own friend never votes on their card. firestore.rules
// repeats statusFor() exactly, so a client can't close a vote early.
export const MAX_LIVES = 9;
export const livesTotal = deck => {
  const n = Number(deck?.lives ?? 5);
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_LIVES, Math.round(n))) : 5;
};

export function livesLeft(deck, p, votes) {
  const lost = votes.filter(v => v.pid === p.id && v.status === 'passed').length;
  return Math.max(0, livesTotal(deck) - lost);
}

export function statusFor(yes, no, eligible) {
  if (yes * 2 > eligible) return 'passed';
  if (no * 2 >= eligible) return 'failed';
  return 'open';
}

// Votes needed to take a life, for display.
export const votesNeeded = eligible => Math.floor(eligible / 2) + 1;
