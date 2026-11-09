// react-konva's default entry loads all of Konva: every shape and twenty image filters. Its core
// build creates nodes from what is registered here, and draws an unregistered one as an empty
// Group, so test/konvaShapes.test.ts checks every component imported from here is registered.
import 'konva/lib/shapes/Circle';
import 'konva/lib/shapes/Image';
import 'konva/lib/shapes/Label';
import 'konva/lib/shapes/Line';
import 'konva/lib/shapes/Path';
import 'konva/lib/shapes/Rect';
import 'konva/lib/shapes/RegularPolygon';
import 'konva/lib/shapes/Text';

export * from 'react-konva/lib/ReactKonvaCore';
