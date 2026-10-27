/**
 * Simple arithmetic operations for demo repository.
 */

export function calculateSum(a: number, b: number): number {
  return a + b;
}

export function calculateAverage(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, curr) => acc + curr, 0);
  return sum / numbers.length;
}

export function isEven(n: number): boolean {
  return n % 2 === 0;
}
