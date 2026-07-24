import fs from 'node:fs';

const SOURCE = fs.readFileSync(new URL('./ascii.txt', import.meta.url), 'utf8');
const MAX_WIDTH = 52;
const MAX_HEIGHT = 16;
const RAMP = ' .:-=+*#%@';
const DENSITY = {
  ' ': 0,
  ':': 0.25,
  '-': 0.48,
  '=': 0.78,
};
const ORANGE_START = [255, 181, 74];
const ORANGE_END = [255, 90, 0];

function sourceLines(source) {
  return source.replace(/\n$/, '').split('\n').map((line) => line.trimEnd());
}

function overlap(start, end, cell) {
  return Math.max(0, Math.min(end, cell + 1) - Math.max(start, cell));
}

/**
 * Downsample the original 100×54 artwork while retaining its shaded edges.
 * Weighted block sampling looks considerably cleaner than dropping rows and
 * columns, especially in narrow terminals.
 */
export function resizeBanner(width = MAX_WIDTH, height = MAX_HEIGHT, source = SOURCE) {
  const lines = sourceLines(source);
  const sourceWidth = Math.max(...lines.map((line) => line.length));
  const output = [];

  for (let y = 0; y < height; y++) {
    const yStart = y * lines.length / height;
    const yEnd = (y + 1) * lines.length / height;
    let row = '';

    for (let x = 0; x < width; x++) {
      const xStart = x * sourceWidth / width;
      const xEnd = (x + 1) * sourceWidth / width;
      let weightedDensity = 0;
      let totalWeight = 0;

      for (let sourceY = Math.floor(yStart); sourceY < Math.ceil(yEnd); sourceY++) {
        const yWeight = overlap(yStart, yEnd, sourceY);
        for (let sourceX = Math.floor(xStart); sourceX < Math.ceil(xEnd); sourceX++) {
          const weight = yWeight * overlap(xStart, xEnd, sourceX);
          const character = lines[sourceY]?.[sourceX] ?? ' ';
          weightedDensity += (DENSITY[character] ?? 0.7) * weight;
          totalWeight += weight;
        }
      }

      const density = totalWeight ? weightedDensity / totalWeight : 0;
      const rampIndex = Math.min(
        RAMP.length - 1,
        Math.round(density * (RAMP.length - 1)),
      );
      row += RAMP[rampIndex];
    }

    output.push(row.trimEnd());
  }

  return output;
}

export function colorsEnabled(stream = process.stdout, env = process.env) {
  if (Object.hasOwn(env, 'NO_COLOR') || env.FORCE_COLOR === '0') return false;
  if (Object.hasOwn(env, 'FORCE_COLOR')) return true;
  return stream.isTTY === true && env.TERM !== 'dumb';
}

function interpolate(start, end, progress) {
  return Math.round(start + (end - start) * progress);
}

function orange(line, row, rowCount) {
  const progress = rowCount <= 1 ? 0 : row / (rowCount - 1);
  const [red, green, blue] = ORANGE_START.map((value, index) =>
    interpolate(value, ORANGE_END[index], progress),
  );
  return `\u001b[38;2;${red};${green};${blue}m${line}\u001b[0m`;
}

export function renderBanner(options = {}) {
  const stream = options.stream ?? process.stdout;
  const columns = Number.isFinite(options.columns)
    ? options.columns
    : (stream.columns ?? MAX_WIDTH);
  const width = Math.min(MAX_WIDTH, Math.max(16, columns - 2));
  const height = Math.max(5, Math.round(width * MAX_HEIGHT / MAX_WIDTH));
  const lines = resizeBanner(width, height);
  const color = options.color ?? colorsEnabled(stream, options.env ?? process.env);

  return lines
    .map((line, row) => color ? orange(line, row, lines.length) : line)
    .join('\n');
}
