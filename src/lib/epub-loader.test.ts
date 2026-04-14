import { describe, test, expect, beforeAll } from 'bun:test';
import { JSDOM } from 'jsdom';
import { pickSplitTag, splitAtHeadings } from './epub-loader';

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  const w = dom.window;
  // @ts-expect-error — test-environment globals
  globalThis.document = w.document;
  // @ts-expect-error
  globalThis.DOMParser = w.DOMParser;
  // @ts-expect-error
  globalThis.Element = w.Element;
  // @ts-expect-error
  globalThis.Node = w.Node;
  // @ts-expect-error
  globalThis.Range = w.Range;
});

const GUTENBERG_STYLE_HTML = `
    <h2>Chapter I.</h2>
    <p>It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.</p>
    <p>However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.</p>
    <h2>Chapter II.</h2>
    <p>Mr. Bennet was among the earliest of those who waited on Mr. Bingley.</p>
    <p>He had always intended to visit him, though to the last always assuring his wife that he should not go.</p>
    <h2>Chapter III.</h2>
    <p>Not all that Mrs. Bennet, however, with the assistance of her five daughters, could say on the subject, was sufficient to draw from her husband any satisfactory description of Mr. Bingley.</p>
`;

function buildBody(innerHtml: string): Element {
  const doc = dom.window.document;
  const div = doc.createElement('div');
  div.innerHTML = innerHtml;
  // Attach to the document so Range operations have a connected tree.
  doc.body.innerHTML = '';
  doc.body.appendChild(div);
  return div;
}

describe('heading-based chapter split', () => {
  test('pickSplitTag returns h2 for a multi-h2 body', () => {
    const body = buildBody(GUTENBERG_STYLE_HTML);
    expect(pickSplitTag(body)).toBe('h2');
  });

  test('pickSplitTag returns null when fewer than 2 headings', () => {
    const body = buildBody('<h1>Only one</h1><p>text</p>');
    expect(pickSplitTag(body)).toBe(null);
  });

  test('pickSplitTag prefers h2 over h1 on ties', () => {
    const body = buildBody('<h1>a</h1><p>x</p><h1>b</h1><h2>c</h2><p>y</p><h2>d</h2>');
    expect(pickSplitTag(body)).toBe('h2');
  });

  test('splitAtHeadings produces one section per heading', () => {
    const body = buildBody(GUTENBERG_STYLE_HTML);
    const sections = splitAtHeadings(body, 'h2');
    expect(sections).toHaveLength(3);
    expect(sections[0].label).toBe('Chapter I.');
    expect(sections[1].label).toBe('Chapter II.');
    expect(sections[2].label).toBe('Chapter III.');
  });

  test('each section contains only its own body text', () => {
    const body = buildBody(GUTENBERG_STYLE_HTML);
    const sections = splitAtHeadings(body, 'h2');
    expect(sections[0].text).toContain('universally acknowledged');
    expect(sections[0].text).not.toContain('Mr. Bennet');
    expect(sections[1].text).toContain('Mr. Bennet was among');
    expect(sections[1].text).not.toContain('universally acknowledged');
    expect(sections[2].text).toContain('Mrs. Bennet, however');
    expect(sections[2].text).not.toContain('Mr. Bennet was among');
  });
});
