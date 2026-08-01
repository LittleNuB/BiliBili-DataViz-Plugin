import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findSidebarAnchor,
  placeSidebarCard,
  SIDEBAR_CARD_ID,
} from '../src/content/sidebar-card/placement.ts';

interface RectInit {
  top?: number;
  width?: number;
  height?: number;
}

class FakeClassList {
  readonly values = new Set<string>();

  add(value: string): void {
    this.values.add(value);
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  readonly classes: string[];
  private readonly rect: RectInit;
  id = '';

  constructor(classes: string[] = [], rect: RectInit = {}) {
    this.classes = classes;
    this.rect = rect;
  }

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  matches(selector: string): boolean {
    return selector.split(',').some(candidate => {
      const className = candidate.trim().replace(/^\./, '');
      return this.classes.includes(className);
    });
  }

  getBoundingClientRect(): DOMRect {
    const top = this.rect.top ?? 0;
    const width = this.rect.width ?? 240;
    const height = this.rect.height ?? 200;
    return {
      x: 0,
      y: top,
      top,
      right: width,
      bottom: top + height,
      left: 0,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  }

  insertBefore(newChild: FakeElement, referenceChild: FakeElement | null): FakeElement {
    if (referenceChild === null) {
      this.children.push(newChild);
      return newChild;
    }
    const index = this.children.indexOf(referenceChild);
    assert.notEqual(index, -1);
    this.children.splice(index, 0, newChild);
    return newChild;
  }
}

class FakeDocument {
  private readonly selectors: Record<string, FakeElement | undefined>;
  private readonly existingCard: FakeElement | null;

  constructor(
    selectors: Record<string, FakeElement | undefined>,
    existingCard: FakeElement | null = null,
  ) {
    this.selectors = selectors;
    this.existingCard = existingCard;
  }

  querySelector(selector: string): Element | null {
    return (this.selectors[selector] ?? null) as unknown as Element | null;
  }

  getElementById(id: string): HTMLElement | null {
    return id === SIDEBAR_CARD_ID
      ? this.existingCard as unknown as HTMLElement | null
      : null;
  }
}

test('selects the validated current Bilibili feed before legacy fallbacks', () => {
  const current = new FakeElement();
  current.children.push(
    new FakeElement(['recommended-swipe']),
    new FakeElement(['feed-card']),
    new FakeElement(['bili-video-card']),
  );
  const legacy = new FakeElement();
  const document = new FakeDocument({
    '.recommended-container_floor-aside > .container': current,
    '.right-container': legacy,
  });

  const anchor = findSidebarAnchor(document);

  assert.equal(anchor?.layout, 'current_feed');
  assert.equal(anchor?.container, current as unknown as Element);
});

test('rejects an unvalidated current container and keeps the legacy fallback', () => {
  const unvalidated = new FakeElement();
  unvalidated.children.push(new FakeElement(['feed-card']));
  const legacy = new FakeElement();
  const document = new FakeDocument({
    '.recommended-container_floor-aside > .container': unvalidated,
    '.recommend-container': legacy,
  });

  const anchor = findSidebarAnchor(document);

  assert.equal(anchor?.layout, 'legacy');
  assert.equal(anchor?.container, legacy as unknown as Element);
});

test('returns no anchor when neither a validated current feed nor a legacy container exists', () => {
  const document = new FakeDocument({});
  assert.equal(findSidebarAnchor(document), null);
});

test('places the card at the first complete feed row after the current carousel', () => {
  const container = new FakeElement();
  const carousel = new FakeElement(['recommended-swipe'], { top: 100, height: 400 });
  const topRow = new FakeElement(['feed-card'], { top: 100 });
  const secondRow = new FakeElement(['feed-card'], { top: 320 });
  const firstFullRow = new FakeElement(['feed-card'], { top: 540 });
  container.children.push(carousel, topRow, secondRow, firstFullRow);
  const card = new FakeElement();
  const document = new FakeDocument({});

  const inserted = placeSidebarCard(
    document,
    { container: container as unknown as Element, layout: 'current_feed' },
    card as unknown as HTMLElement,
  );

  assert.equal(inserted, true);
  assert.equal(container.children.indexOf(card), 3);
  assert.equal(container.children[4], firstFullRow);
  assert.equal(card.classList.values.has('bdc-card--feed'), true);
});

test('places the card first in a legacy sidebar container', () => {
  const container = new FakeElement();
  const existingChild = new FakeElement();
  const card = new FakeElement();
  container.children.push(existingChild);
  const document = new FakeDocument({});

  const inserted = placeSidebarCard(
    document,
    { container: container as unknown as Element, layout: 'legacy' },
    card as unknown as HTMLElement,
  );

  assert.equal(inserted, true);
  assert.deepEqual(container.children, [card, existingChild]);
  assert.equal(card.classList.values.has('bdc-card--feed'), false);
});

test('does not insert a duplicate card', () => {
  const container = new FakeElement();
  const existing = new FakeElement();
  const card = new FakeElement();
  const document = new FakeDocument({}, existing);

  const inserted = placeSidebarCard(
    document,
    { container: container as unknown as Element, layout: 'legacy' },
    card as unknown as HTMLElement,
  );

  assert.equal(inserted, false);
  assert.equal(container.children.length, 0);
});
