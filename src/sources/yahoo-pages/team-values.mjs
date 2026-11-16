// team-values.txt: the `find` results for "Waiver Budget" saved by a Chrome capture, one matched
// element per line, as the tool printed them. Only the FAAB balance is read, from the first
// "Waiver Budget: $N" match. Adds used and pending claims are not read from this file.
export function parseTeamValues(text) {
  const m = /Waiver Budget:\s*\$\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (!m) throw new Error('no "Waiver Budget: $N" match');
  return { faabBalance: Number(m[1]) };
}
