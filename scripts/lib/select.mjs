/**
 * Unambiguous selectors for the diagnostic scripts.
 *
 * These tools are used to reason about real money, so silently picking the first
 * of several matches is the wrong default: group names are not unique and can be
 * renamed, so a partial name can legitimately match two groups and the script
 * would inspect whichever Firestore happened to stream first. Every ambiguity is
 * reported and refused instead.
 */

/**
 * Resolves a group by exact id first, then by case-insensitive name substring.
 * Exits with the candidates listed when the selector matches none or several.
 */
export function selectGroup(groups, selector) {
  const needle = (selector || "").trim();
  if (!needle) {
    console.error("Pass a group id or name.");
    listGroups(groups);
    process.exit(1);
  }

  // An exact id always wins, so an id is never treated as ambiguous even if it
  // also happens to appear inside some group's name.
  const byId = groups.find((g) => g.id === needle);
  if (byId) return byId;

  const lower = needle.toLowerCase();
  const exactName = groups.filter((g) => (g.name || "").toLowerCase() === lower);
  if (exactName.length === 1) return exactName[0];

  const candidates = (exactName.length > 1 ? exactName : groups.filter((g) =>
    (g.name || "").toLowerCase().includes(lower)
  ));

  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    console.error(`No group matched "${needle}".`);
    listGroups(groups);
    process.exit(1);
  }

  console.error(`"${needle}" is ambiguous — it matches ${candidates.length} groups.`);
  console.error("Re-run with the exact group id:");
  for (const g of candidates) console.error(`  ${g.id}  ${g.name}`);
  process.exit(1);
}

function listGroups(groups) {
  console.error("\nAvailable groups:");
  for (const g of groups) console.error(`  ${g.id}  ${g.name}`);
}

/**
 * Resolves one person within a group's ledger by exact uid, then by
 * case-insensitive name substring, refusing ambiguity the same way.
 *
 * `candidates` must be the full ledger participant set, not just current
 * members: an outstanding balance can involve someone who has left the group,
 * and that is exactly the case worth tracing.
 */
export function selectPerson(candidates, nameOf, selector, label) {
  const needle = (selector || "").trim();
  if (!needle) {
    console.error(`Pass a ${label}.`);
    process.exit(1);
  }

  if (candidates.includes(needle)) return needle;

  const lower = needle.toLowerCase();
  const exact = candidates.filter((uid) => nameOf(uid).toLowerCase() === lower);
  if (exact.length === 1) return exact[0];

  const matches = exact.length > 1 ? exact : candidates.filter((uid) =>
    nameOf(uid).toLowerCase().includes(lower)
  );

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    console.error(`No ${label} matching "${needle}" appears in this group's ledger.`);
    console.error("\nPeople in this ledger:");
    for (const uid of candidates) console.error(`  ${uid}  ${nameOf(uid)}`);
    process.exit(1);
  }

  console.error(`"${needle}" is ambiguous — it matches ${matches.length} people.`);
  console.error("Re-run with the exact uid:");
  for (const uid of matches) console.error(`  ${uid}  ${nameOf(uid)}`);
  process.exit(1);
}
