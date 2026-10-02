/**
 * A short mishear of hot, cold, iced, or room.
 * "hod" is hot. "cod" is cold. A longer word such as "could" stays itself.
 */

const TEMPERATURES = [
  { word: "hot", as: "hot" },
  { word: "cold", as: "cold" },
  { word: "iced", as: "iced" },
  { word: "ice", as: "ice" },
  { word: "room", as: "room" },
] as const;

/** Rewrite a close temperature miss. Exact words and unrelated words stay. */
export function foldCloseTemperatures(text: string): string {
  return text.replace(/[A-Za-z]+/g, (token) => closeTemperature(token.toLowerCase()) ?? token);
}

function closeTemperature(token: string): string | null {
  if (token.length < 3) return null;
  if (TEMPERATURES.some((key) => key.word === token)) return null;
  let winner: string | null = null;
  for (const key of TEMPERATURES) {
    if (token.length > key.word.length) continue;
    if (key.word.length - token.length > 1) continue;
    if (sharedPrefix(token, key.word) < 2) continue;
    if (editDistance(token, key.word) !== 1) continue;
    if (winner && winner !== key.as) return null;
    winner = key.as;
  }
  return winner;
}

function sharedPrefix(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid: number[] = Array.from({ length: rows * cols }, () => 0);
  for (let row = 0; row < rows; row += 1) grid[row * cols] = row;
  for (let col = 0; col < cols; col += 1) grid[col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      const insert = (grid[row * cols + (col - 1)] ?? 0) + 1;
      const remove = (grid[(row - 1) * cols + col] ?? 0) + 1;
      const replace = (grid[(row - 1) * cols + (col - 1)] ?? 0) + cost;
      grid[row * cols + col] = Math.min(insert, remove, replace);
    }
  }
  return grid[left.length * cols + right.length] ?? left.length + right.length;
}
