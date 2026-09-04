const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const CONTAINERS = new Set(['svg', 'g']);
const IGNORED = new Set(['title', 'desc', 'metadata', 'defs', 'clippath']);
const STYLE_KEYS = new Set([
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'display',
  'visibility',
  'opacity',
  'clip-rule',
]);
const PRESENTATION_KEYS = new Set([...STYLE_KEYS, 'clip-path']);
const REJECTED_ATTRIBUTES = new Set([
  'mask',
  'filter',
  'marker',
  'marker-start',
  'marker-mid',
  'marker-end',
  'vector-effect',
  'paint-order',
  'transform-origin',
  'transform-box',
  'mix-blend-mode',
]);
const DEFAULT_STYLE = Object.freeze({
  fill: 'black',
  'fill-rule': 'nonzero',
  'fill-opacity': '1',
  stroke: 'none',
  'stroke-width': '1',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  'stroke-miterlimit': '4',
  'stroke-opacity': '1',
  'stroke-dasharray': 'none',
  'stroke-dashoffset': '0',
  display: 'inline',
  visibility: 'visible',
  opacity: '1',
  'clip-rule': 'nonzero',
});
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export class ConversionError extends Error {
  constructor(code, detail = '') {
    super(detail || code);
    this.name = 'ConversionError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail = '') {
  throw new ConversionError(code, detail);
}

function tagName(element) {
  return String(element.localName || element.nodeName || '').split(':').pop().toLowerCase();
}

function parseStyleAttribute(value) {
  const declarations = {};
  for (const part of String(value || '').split(';')) {
    if (!part.trim()) continue;
    const colon = part.indexOf(':');
    if (colon < 1) fail('unsupportedStyle', part.trim());
    const key = part.slice(0, colon).trim().toLowerCase();
    if (!PRESENTATION_KEYS.has(key)) fail('unsupportedStyle', key);
    const declaration = part.slice(colon + 1).trim().replace(/\s*!important\s*$/i, '');
    if (/url\s*\(/i.test(declaration) && key !== 'clip-path') fail('externalReference', key);
    declarations[key] = declaration;
  }
  return declarations;
}

function getAttributes(element) {
  const values = {};
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index);
    values[attribute.name.toLowerCase()] = attribute.value;
  }
  return values;
}

function parseClipReference(value) {
  const source = String(value || '').trim();
  if (!source || source.toLowerCase() === 'none') return null;
  const match = source.match(/^url\(\s*(['"]?)#([^\s'"()]+)\1\s*\)$/i);
  if (!match) fail('externalReference', 'clip-path');
  return match[2];
}

function validateAttributes(element, attributes) {
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith('on')) fail('unsafeContent', name);
    if (name === 'href' || name === 'xlink:href') fail('externalReference', name);
    if (REJECTED_ATTRIBUTES.has(name)) fail('unsupportedAttribute', name);
    if (name === 'clip-path') {
      parseClipReference(value);
      continue;
    }
    if (name === 'style') continue;
    if (/url\s*\(/i.test(value)) fail('externalReference', name);
  }
}

function mergeStyle(parent, attributes, declarations) {
  const style = { ...parent };
  for (const key of STYLE_KEYS) {
    if (attributes[key] != null) style[key] = attributes[key].trim();
  }
  for (const key of STYLE_KEYS) {
    if (declarations[key] != null) style[key] = declarations[key];
  }
  return style;
}

function parseOpacity(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) fail('invalidAttribute', name);
  if (number > 0 && number < 1) fail('partialOpacity', name);
  return number;
}

function hidesSubtree(style) {
  return (
    String(style.display).toLowerCase() === 'none' ||
    parseOpacity(style.opacity, 'opacity') === 0
  );
}

function parseNumber(value, name, fallback = 0, { positive = false } = {}) {
  if (value == null || value === '') return fallback;
  const match = String(value).trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px)?$/i);
  if (!match) fail('invalidAttribute', name);
  const number = Number(match[1]);
  if (!Number.isFinite(number) || (positive && number <= 0)) fail('invalidAttribute', name);
  return number;
}

function multiply(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformMatrix(name, args) {
  switch (name.toLowerCase()) {
    case 'matrix':
      if (args.length !== 6) fail('invalidTransform', name);
      return args;
    case 'translate':
      if (args.length < 1 || args.length > 2) fail('invalidTransform', name);
      return [1, 0, 0, 1, args[0], args[1] || 0];
    case 'scale':
      if (args.length < 1 || args.length > 2) fail('invalidTransform', name);
      return [args[0], 0, 0, args.length === 2 ? args[1] : args[0], 0, 0];
    case 'rotate': {
      if (args.length !== 1 && args.length !== 3) fail('invalidTransform', name);
      const radians = (args[0] * Math.PI) / 180;
      const rotation = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
      if (args.length === 1) return rotation;
      return multiply(multiply([1, 0, 0, 1, args[1], args[2]], rotation), [1, 0, 0, 1, -args[1], -args[2]]);
    }
    case 'skewx':
      if (args.length !== 1) fail('invalidTransform', name);
      return [1, 0, Math.tan((args[0] * Math.PI) / 180), 1, 0, 0];
    case 'skewy':
      if (args.length !== 1) fail('invalidTransform', name);
      return [1, Math.tan((args[0] * Math.PI) / 180), 0, 1, 0, 0];
    default:
      fail('invalidTransform', name);
  }
}

export function parseTransform(value) {
  if (!value || !String(value).trim()) return [...IDENTITY];
  const source = String(value);
  const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let matrix = [...IDENTITY];
  let lastIndex = 0;
  let match;
  while ((match = expression.exec(source))) {
    if (source.slice(lastIndex, match.index).replace(/[\s,]+/g, '')) fail('invalidTransform');
    const rawArgs = match[2].trim();
    const args = rawArgs ? rawArgs.split(/[\s,]+/).map(Number) : [];
    if (args.some((number) => !Number.isFinite(number))) fail('invalidTransform', match[1]);
    matrix = multiply(matrix, transformMatrix(match[1], args));
    lastIndex = expression.lastIndex;
  }
  if (!lastIndex || source.slice(lastIndex).replace(/[\s,]+/g, '')) fail('invalidTransform');
  return matrix;
}

function pathKitMatrix(matrix) {
  return [matrix[0], matrix[2], matrix[4], matrix[1], matrix[3], matrix[5], 0, 0, 1];
}

function numberString(number) {
  return Number(number.toFixed(6)).toString();
}

function pointsPath(value, closed) {
  const points = String(value || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (points.length < 4 || points.length % 2 || points.some((point) => !Number.isFinite(point))) {
    fail('invalidShape', 'points');
  }
  let d = `M${points[0]} ${points[1]}`;
  for (let index = 2; index < points.length; index += 2) d += `L${points[index]} ${points[index + 1]}`;
  return closed ? `${d}Z` : d;
}

function shapePath(tag, attributes) {
  if (tag === 'path') {
    if (!attributes.d || !attributes.d.trim()) fail('invalidShape', 'path');
    return attributes.d.trim();
  }
  if (tag === 'line') {
    return `M${parseNumber(attributes.x1, 'x1')} ${parseNumber(attributes.y1, 'y1')}L${parseNumber(attributes.x2, 'x2')} ${parseNumber(attributes.y2, 'y2')}`;
  }
  if (tag === 'polyline' || tag === 'polygon') return pointsPath(attributes.points, tag === 'polygon');
  if (tag === 'circle') {
    const cx = parseNumber(attributes.cx, 'cx');
    const cy = parseNumber(attributes.cy, 'cy');
    const radius = parseNumber(attributes.r, 'r', 0, { positive: true });
    return `M${cx - radius} ${cy}A${radius} ${radius} 0 1 0 ${cx + radius} ${cy}A${radius} ${radius} 0 1 0 ${cx - radius} ${cy}Z`;
  }
  if (tag === 'ellipse') {
    const cx = parseNumber(attributes.cx, 'cx');
    const cy = parseNumber(attributes.cy, 'cy');
    const rx = parseNumber(attributes.rx, 'rx', 0, { positive: true });
    const ry = parseNumber(attributes.ry, 'ry', 0, { positive: true });
    return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
  }

  const x = parseNumber(attributes.x, 'x');
  const y = parseNumber(attributes.y, 'y');
  const width = parseNumber(attributes.width, 'width', 0, { positive: true });
  const height = parseNumber(attributes.height, 'height', 0, { positive: true });
  let rx = attributes.rx == null ? null : parseNumber(attributes.rx, 'rx');
  let ry = attributes.ry == null ? null : parseNumber(attributes.ry, 'ry');
  if (rx == null && ry != null) rx = ry;
  if (ry == null && rx != null) ry = rx;
  rx = Math.min(Math.max(rx || 0, 0), width / 2);
  ry = Math.min(Math.max(ry || 0, 0), height / 2);
  if (!rx || !ry) return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
  return [
    `M${x + rx} ${y}`,
    `H${x + width - rx}`,
    `A${rx} ${ry} 0 0 1 ${x + width} ${y + ry}`,
    `V${y + height - ry}`,
    `A${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}`,
    `H${x + rx}`,
    `A${rx} ${ry} 0 0 1 ${x} ${y + height - ry}`,
    `V${y + ry}`,
    `A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
  ].join('');
}

function parseViewBox(root, attributes) {
  const raw = root.getAttribute('viewBox');
  if (raw) {
    const values = raw.trim().split(/[\s,]+/).map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) {
      fail('invalidViewBox');
    }
    return values.map(numberString).join(' ');
  }
  const width = parseNumber(attributes.width, 'width', 0, { positive: true });
  const height = parseNumber(attributes.height, 'height', 0, { positive: true });
  return `0 0 ${numberString(width)} ${numberString(height)}`;
}

function contoursFromCommands(commands) {
  const contours = [];
  let contour = null;
  let current = null;
  for (const command of commands) {
    const type = command[0];
    if (type === 0) {
      if (contour) contours.push(contour);
      current = { x: command[1], y: command[2] };
      contour = { start: current, segments: [], closed: false };
      continue;
    }
    if (!contour) continue;
    if (type === 5) {
      contour.closed = true;
      continue;
    }
    const endpointIndex = type === 1 ? 1 : type === 2 || type === 3 ? 3 : 5;
    const end = { x: command[endpointIndex], y: command[endpointIndex + 1] };
    contour.segments.push({ type, values: command.slice(1), start: current, end });
    current = end;
  }
  if (contour) contours.push(contour);
  return contours;
}

function sampleContour(contour, samples = 12) {
  const points = [{ ...contour.start }];
  for (const segment of contour.segments) {
    const { start, end, values, type } = segment;
    if (type === 1) {
      points.push({ ...end });
      continue;
    }
    for (let step = 1; step <= samples; step++) {
      const t = step / samples;
      const u = 1 - t;
      if (type === 2) {
        points.push({
          x: u * u * start.x + 2 * u * t * values[0] + t * t * end.x,
          y: u * u * start.y + 2 * u * t * values[1] + t * t * end.y,
        });
      } else if (type === 4) {
        points.push({
          x: u ** 3 * start.x + 3 * u * u * t * values[0] + 3 * u * t * t * values[2] + t ** 3 * end.x,
          y: u ** 3 * start.y + 3 * u * u * t * values[1] + 3 * u * t * t * values[3] + t ** 3 * end.y,
        });
      } else {
        const weight = values[4];
        const denominator = u * u + 2 * weight * u * t + t * t;
        points.push({
          x: (u * u * start.x + 2 * weight * u * t * values[0] + t * t * end.x) / denominator,
          y: (u * u * start.y + 2 * weight * u * t * values[1] + t * t * end.y) / denominator,
        });
      }
    }
  }
  return points;
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function interiorPoint(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const epsilon = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) * 1e-5;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) continue;
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const normal = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
    for (const direction of [1, -1]) {
      const candidate = {
        x: midpoint.x + normal.x * epsilon * direction,
        y: midpoint.y + normal.y * epsilon * direction,
      };
      if (pointInPolygon(candidate, points)) return candidate;
    }
  }
  return points[0];
}

function appendContour(path, contour, reverse) {
  if (!contour.segments.length) return;
  if (!reverse) {
    path.moveTo(contour.start.x, contour.start.y);
    for (const segment of contour.segments) {
      const value = segment.values;
      if (segment.type === 1) path.lineTo(value[0], value[1]);
      else if (segment.type === 2) path.quadTo(value[0], value[1], value[2], value[3]);
      else if (segment.type === 3) path.conicTo(value[0], value[1], value[2], value[3], value[4]);
      else path.cubicTo(value[0], value[1], value[2], value[3], value[4], value[5]);
    }
  } else {
    const last = contour.segments[contour.segments.length - 1].end;
    path.moveTo(last.x, last.y);
    for (let index = contour.segments.length - 1; index >= 0; index--) {
      const segment = contour.segments[index];
      const value = segment.values;
      if (segment.type === 1) path.lineTo(segment.start.x, segment.start.y);
      else if (segment.type === 2) path.quadTo(value[0], value[1], segment.start.x, segment.start.y);
      else if (segment.type === 3) path.conicTo(value[0], value[1], segment.start.x, segment.start.y, value[4]);
      else path.cubicTo(value[2], value[3], value[0], value[1], segment.start.x, segment.start.y);
    }
  }
  if (contour.closed) path.close();
}

function evenOddAsWinding(pathKit, path) {
  if (!path.simplify()) fail('invalidPath');
  const contours = contoursFromCommands(path.toCmds());
  const polygons = contours.map((contour) => sampleContour(contour));
  const result = pathKit.NewPath();

  contours.forEach((contour, index) => {
    const point = interiorPoint(polygons[index]);
    const depth = polygons.reduce((count, polygon, otherIndex) => (
      otherIndex !== index && pointInPolygon(point, polygon) ? count + 1 : count
    ), 0);
    const orientation = Math.sign(signedArea(polygons[index])) || 1;
    const wanted = depth % 2 === 0 ? 1 : -1;
    appendContour(result, contour, orientation !== wanted);
  });
  result.setFillType(pathKit.FillType.WINDING);
  return result;
}

function visibleFill(style, tag) {
  return tag !== 'line' && String(style.fill).toLowerCase() !== 'none' && parseOpacity(style['fill-opacity'], 'fill-opacity') !== 0;
}

function visibleStroke(style) {
  if (String(style.stroke).toLowerCase() === 'none' || parseOpacity(style['stroke-opacity'], 'stroke-opacity') === 0) return false;
  if (String(style['stroke-dasharray']).toLowerCase() !== 'none') fail('dashedStroke');
  if (parseNumber(style['stroke-dashoffset'], 'stroke-dashoffset') !== 0) fail('dashedStroke');
  return parseNumber(style['stroke-width'], 'stroke-width', 1) > 0;
}

function transformPath(path, matrix) {
  if (!path.transform(pathKitMatrix(matrix))) fail('invalidTransform');
  return path;
}

function serializePath(path) {
  const data = path.toSVGString();
  return data;
}

function applyClips(pathKit, path, clips) {
  for (const clip of clips) {
    if (!path.op(clip, pathKit.PathOp.INTERSECT)) fail('invalidPath');
  }
  return path;
}

function appendOutput(pathKit, path, matrix, clips, output) {
  transformPath(path, matrix);
  applyClips(pathKit, path, clips);
  const data = serializePath(path);
  if (data) output.push(data);
}

function convertGeometry(pathKit, tag, attributes, style, matrix, clips, output) {
  const data = shapePath(tag, attributes);
  const base = pathKit.FromSVGString(data);
  if (!base) fail('invalidPath');

  try {
    if (visibleFill(style, tag)) {
      let fill = base.copy();
      try {
        if (String(style['fill-rule']).toLowerCase() === 'evenodd') {
          fill.setFillType(pathKit.FillType.EVENODD);
          const winding = evenOddAsWinding(pathKit, fill);
          fill.delete();
          fill = winding;
        } else if (String(style['fill-rule']).toLowerCase() !== 'nonzero') {
          fail('invalidAttribute', 'fill-rule');
        }
        if (!fill.simplify()) fail('invalidPath');
        appendOutput(pathKit, fill, matrix, clips, output);
      } finally {
        fill.delete();
      }
    }

    if (visibleStroke(style)) {
      const stroke = base.copy();
      try {
        const caps = { butt: pathKit.StrokeCap.BUTT, round: pathKit.StrokeCap.ROUND, square: pathKit.StrokeCap.SQUARE };
        const joins = { miter: pathKit.StrokeJoin.MITER, round: pathKit.StrokeJoin.ROUND, bevel: pathKit.StrokeJoin.BEVEL };
        const cap = caps[String(style['stroke-linecap']).toLowerCase()];
        const join = joins[String(style['stroke-linejoin']).toLowerCase()];
        if (!cap || !join) fail('invalidAttribute', !cap ? 'stroke-linecap' : 'stroke-linejoin');
        if (!stroke.stroke({
          width: parseNumber(style['stroke-width'], 'stroke-width', 1),
          cap,
          join,
          miter_limit: parseNumber(style['stroke-miterlimit'], 'stroke-miterlimit', 4),
        })) fail('invalidPath');
        appendOutput(pathKit, stroke, matrix, clips, output);
      } finally {
        stroke.delete();
      }
    }
  } finally {
    base.delete();
  }
}

function addClipGeometry(pathKit, destination, element, parentStyle, parentMatrix) {
  const tag = tagName(element);
  const attributes = getAttributes(element);
  validateAttributes(element, attributes);
  if (!SHAPES.has(tag) && tag !== 'g') fail('unsupportedElement', tag);

  const declarations = attributes.style == null ? {} : parseStyleAttribute(attributes.style);
  if (attributes['clip-path'] != null || declarations['clip-path'] != null) {
    fail('unsupportedAttribute', 'clip-path');
  }
  const style = mergeStyle(parentStyle, attributes, declarations);
  if (hidesSubtree(style)) return;
  const matrix = multiply(parentMatrix, parseTransform(attributes.transform));

  if (SHAPES.has(tag)) {
    if (String(style.visibility).toLowerCase() === 'hidden') return;
    const path = pathKit.FromSVGString(shapePath(tag, attributes));
    if (!path) fail('invalidPath');
    try {
      const rule = String(style['clip-rule']).toLowerCase();
      if (rule === 'evenodd') {
        path.setFillType(pathKit.FillType.EVENODD);
      } else if (rule !== 'nonzero') {
        fail('invalidAttribute', 'clip-rule');
      }
      transformPath(path, matrix);
      if (!destination.op(path, pathKit.PathOp.UNION)) fail('invalidPath');
    } finally {
      path.delete();
    }
    return;
  }

  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) addClipGeometry(pathKit, destination, child, style, matrix);
  }
}

function buildClip(pathKit, reference, definitions, matrix) {
  const element = definitions.get(reference);
  if (!element) fail('invalidAttribute', 'clip-path');
  const attributes = getAttributes(element);
  validateAttributes(element, attributes);
  const units = String(attributes.clippathunits || 'userSpaceOnUse').toLowerCase();
  if (units !== 'userspaceonuse') fail('unsupportedAttribute', 'clipPathUnits');
  const clipMatrix = multiply(matrix, parseTransform(attributes.transform));
  const clip = pathKit.NewPath();
  try {
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) addClipGeometry(pathKit, clip, child, DEFAULT_STYLE, clipMatrix);
    }
    return clip;
  } catch (error) {
    clip.delete();
    throw error;
  }
}

function walk(pathKit, element, parentStyle, parentMatrix, clips, definitions, output, isRoot = false) {
  const tag = tagName(element);
  const attributes = getAttributes(element);
  validateAttributes(element, attributes);

  if (IGNORED.has(tag)) return;
  if (!SHAPES.has(tag) && !CONTAINERS.has(tag)) fail('unsupportedElement', tag);
  if (tag === 'svg' && !isRoot) fail('unsupportedElement', 'svg');

  const declarations = attributes.style == null ? {} : parseStyleAttribute(attributes.style);
  const style = mergeStyle(parentStyle, attributes, declarations);
  if (hidesSubtree(style)) return;
  const matrix = multiply(parentMatrix, parseTransform(attributes.transform));
  const clipValue = declarations['clip-path'] ?? attributes['clip-path'];
  const reference = clipValue == null ? null : parseClipReference(clipValue);
  const localClip = reference == null ? null : buildClip(pathKit, reference, definitions, matrix);
  const activeClips = localClip == null ? clips : [...clips, localClip];

  try {
    if (SHAPES.has(tag)) {
      if (String(style.visibility).toLowerCase() === 'hidden') return;
      convertGeometry(pathKit, tag, attributes, style, matrix, activeClips, output);
      return;
    }

    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) walk(pathKit, child, style, matrix, activeClips, definitions, output, false);
    }
  } finally {
    if (localClip) localClip.delete();
  }
}

function createParser(Parser) {
  try {
    return new Parser({ errorHandler: () => {} });
  } catch {
    return new Parser();
  }
}

function collectClipPaths(root) {
  const definitions = new Map();
  const visit = (element) => {
    if (tagName(element) === 'clippath') {
      const id = element.getAttribute('id');
      if (!id || definitions.has(id)) fail('invalidAttribute', 'clip-path');
      definitions.set(id, element);
    }
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child);
    }
  };
  visit(root);
  return definitions;
}

export function convertSvg(svgSource, pathKit, Parser = globalThis.DOMParser) {
  if (typeof svgSource !== 'string' || !svgSource.trim()) fail('malformedSvg');
  if (!Parser || !pathKit) fail('engineUnavailable');
  if (/<!DOCTYPE|<!ENTITY/i.test(svgSource)) fail('unsafeContent', 'doctype');

  let document;
  try {
    document = createParser(Parser).parseFromString(svgSource, 'image/svg+xml');
  } catch {
    fail('malformedSvg');
  }
  const root = document.documentElement;
  if (!root || tagName(root) !== 'svg' || document.getElementsByTagName('parsererror').length) fail('malformedSvg');
  if (root.namespaceURI && root.namespaceURI !== SVG_NS) fail('malformedSvg');

  const rootAttributes = getAttributes(root);
  const viewBox = parseViewBox(root, rootAttributes);
  const definitions = collectClipPaths(root);
  const paths = [];
  walk(pathKit, root, DEFAULT_STYLE, IDENTITY, [], definitions, paths, true);
  if (!paths.length) fail('emptyGeometry');

  return `<svg viewBox="${viewBox}" fill="black" xmlns="${SVG_NS}">\n${paths.map((data) => `  <path d="${data}"/>`).join('\n')}\n</svg>`;
}

export function isAlreadyConverted(svgSource, Parser = globalThis.DOMParser) {
  if (typeof svgSource !== 'string' || !svgSource.trim()) return false;
  if (!svgSource.includes('<svg') || !svgSource.includes('</svg>')) return false;
  if (!Parser) return false;

  try {
    const document = createParser(Parser).parseFromString(svgSource, 'image/svg+xml');
    if (document.getElementsByTagName('parsererror').length) return false;
    const root = document.documentElement;
    if (!root || tagName(root) !== 'svg') return false;
    if (root.namespaceURI && root.namespaceURI !== SVG_NS) return false;

    const rootAttrs = Array.from(root.attributes).map((a) => a.name.toLowerCase());
    const validRootAttrs = new Set(['xmlns', 'viewbox', 'fill']);
    if (!rootAttrs.every((name) => validRootAttrs.has(name))) return false;
    if (root.getAttribute('fill') !== 'black') return false;
    if (!root.getAttribute('viewBox')) return false;

    const children = Array.from(root.childNodes).filter((node) => node.nodeType === 1);
    if (!children.length) return false;

    for (const child of children) {
      if (tagName(child) !== 'path') return false;
      const childAttrs = Array.from(child.attributes).map((a) => a.name.toLowerCase());
      if (childAttrs.length !== 1 || childAttrs[0] !== 'd') return false;
      if (!child.getAttribute('d')) return false;
    }

    if (root.getElementsByTagName('*').length !== children.length) return false;

    return true;
  } catch {
    return false;
  }
}

