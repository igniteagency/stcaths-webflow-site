// Configurable scaling
const minScreen = 320; // Minimum screen width in pixels
const exponent = 1.5; // Controls non-linearity: >1 means small spacers shrink less, large spacers shrink more
const maxShrink = 0.98; // Smallest spacers shrink to 98% of their size
const minShrink = 0.5; // Largest spacers shrink to 40% of their size

/**
 * Calculates the shrink factor for a given spacer size.
 * Larger spacers will shrink more than smaller ones.
 * @param {number} size - The spacer size in rem.
 * @param {number[]} allSizes - Array of all spacer sizes.
 * @returns {number} The shrink factor.
 */
function sizeShrinkFactor(size, allSizes) {
  const minSizeVal = Math.min(...allSizes);
  const maxSizeVal = Math.max(...allSizes);
  if (minSizeVal === maxSizeVal) return (minShrink + maxShrink) / 2;
  const normalized = (maxSizeVal - size) / (maxSizeVal - minSizeVal);
  // Weighted interpolation for monotonicity
  return minShrink + (maxShrink - minShrink) * Math.pow(normalized, exponent);
}

/**
 * Generates CSS custom properties for fluid spacers.
 * @param {number[]} sizes - An array of spacer sizes in rem.
 * @returns {string} A string of CSS variables.
 */
function generateSpacers(sizes) {
  let css = `
:root {
  /* Fluid Spacers */\n`;

  sizes.forEach((size) => {
    const shrinkFactor = sizeShrinkFactor(size, sizes);
    let minSizeRaw = size * shrinkFactor;
    let minSize = +Math.max(0.1, minSizeRaw).toFixed(4); // min value in rem, never below 0.1
    const maxSize = size; // max value in rem

    let slope = +(maxSize - minSize).toFixed(4);

    // Correct CSS fluid formula:
    // clamp(min, calc(min + (max - min) * ((100vw - minScreenPx) / 100)), max)
    const fluidValue = `${minSize}rem + (${slope} * ((100vw - ${minScreen}px) / 100))`;

    // Replace dots with dashes for CSS variable name
    const safeName = String(size).replace('.', '-');
    css += `  --_space---${safeName}: clamp(${minSize}rem, calc(${fluidValue}), ${maxSize}rem);\n`;
  });

  css += `}\n`;
  return css;
}

// Example usage:
const spacers = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10];

const outputCSS = generateSpacers(spacers);

// You can copy this output into your project's CSS
console.log(outputCSS);
