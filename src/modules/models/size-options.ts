export interface SizeOptionInput {
  label: string;
  value: string;
}

export interface DescribedSizeOption extends SizeOptionInput {
  width: number;
  height: number;
  resolution: string;
  orientationKey: string;
  orientationLabel: string;
}

export interface SizeOptionGrouping {
  options: DescribedSizeOption[];
  resolutions: string[];
  orientations: Array<{ key: string; label: string }>;
}

const RESOLUTION_PATTERN = /(\d+(?:\.\d+)?K)/i;

function inferResolution(width: number, height: number): string {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= 1600) {
    return "1K";
  }
  if (longestEdge <= 2560) {
    return "2K";
  }
  return "4K";
}

export function describeSizeOption(option: SizeOptionInput): DescribedSizeOption {
  const [widthText, heightText] = option.value.split("x");
  const width = Number(widthText);
  const height = Number(heightText);
  const resolution = option.label.match(RESOLUTION_PATTERN)?.[1]?.toUpperCase()
    ?? inferResolution(width, height);
  const orientationLabel = option.label
    .replace(/[（(]?\s*\d+(?:\.\d+)?K\s*[）)]?/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || `${width}×${height}`;

  return {
    ...option,
    width,
    height,
    resolution,
    orientationKey: orientationLabel,
    orientationLabel,
  };
}

export function groupSizeOptions(options: SizeOptionInput[]): SizeOptionGrouping {
  const describedOptions = options.map(describeSizeOption);
  const resolutions: string[] = [];
  const orientations: Array<{ key: string; label: string }> = [];
  const seenResolutions = new Set<string>();
  const seenOrientations = new Set<string>();

  for (const option of describedOptions) {
    if (!seenResolutions.has(option.resolution)) {
      seenResolutions.add(option.resolution);
      resolutions.push(option.resolution);
    }
    if (!seenOrientations.has(option.orientationKey)) {
      seenOrientations.add(option.orientationKey);
      orientations.push({ key: option.orientationKey, label: option.orientationLabel });
    }
  }

  return { options: describedOptions, resolutions, orientations };
}
