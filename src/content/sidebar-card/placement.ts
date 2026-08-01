export const SIDEBAR_CARD_ID = 'bdc-sidebar-card';

export interface SidebarAnchor {
  container: Element;
  layout: 'current_feed' | 'legacy';
}

const CURRENT_FEED_SELECTOR = '.recommended-container_floor-aside > .container';
const LEGACY_SELECTORS = ['.right-container', '.recommend-container', '.home-content'];
const FEED_ITEM_SELECTOR = '.feed-card, .bili-video-card, .floor-single-card';

export function findSidebarAnchor(
  root: Pick<Document, 'querySelector'> = document,
): SidebarAnchor | null {
  const currentFeed = root.querySelector(CURRENT_FEED_SELECTOR);
  if (currentFeed && isValidatedCurrentFeed(currentFeed)) {
    return { container: currentFeed, layout: 'current_feed' };
  }

  for (const selector of LEGACY_SELECTORS) {
    const container = root.querySelector(selector);
    if (container) {
      return { container, layout: 'legacy' };
    }
  }

  return null;
}

export function placeSidebarCard(
  root: Pick<Document, 'getElementById'>,
  anchor: SidebarAnchor,
  card: HTMLElement,
): boolean {
  if (root.getElementById(SIDEBAR_CARD_ID)) return false;

  if (anchor.layout === 'current_feed') {
    card.classList.add('bdc-card--feed');
    const insertionPoint = findFirstFullFeedRow(anchor.container);
    anchor.container.insertBefore(card, insertionPoint);
  } else {
    anchor.container.insertBefore(card, anchor.container.firstChild);
  }

  return true;
}

function isValidatedCurrentFeed(container: Element): boolean {
  const children = Array.from(container.children);
  const hasCarousel = children.some(child => child.matches('.recommended-swipe'));
  const feedItemCount = children.filter(isFeedItem).length;
  return hasCarousel && feedItemCount >= 2;
}

function findFirstFullFeedRow(container: Element): Element | null {
  const children = Array.from(container.children);
  const carousel = children.find(child => child.matches('.recommended-swipe'));
  if (!carousel) {
    return children.find(isFeedItem) ?? null;
  }

  const carouselBottom = carousel.getBoundingClientRect().bottom;
  return children.find(child => {
    if (!isFeedItem(child)) return false;
    const rect = child.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= carouselBottom - 1;
  }) ?? null;
}

function isFeedItem(element: Element): boolean {
  return element.matches(FEED_ITEM_SELECTOR);
}
