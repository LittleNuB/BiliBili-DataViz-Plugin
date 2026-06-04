export interface VideoInfo {
  avid: number;
  bvid: string;
  title: string;
  desc?: string;
  duration: number;
  pubdate?: number;
  ctime?: number;
  owner: {
    mid: number;
    name: string;
    face: string;
  };
  tname: string;
  tags: string[];
  pic: string;
  stat: {
    view: number;
    danmaku: number;
    reply: number;
    favorite: number;
    coin: number;
    share: number;
    like: number;
  };
}

export interface BiliApiResponse<T> {
  code: number;
  message: string;
  data: T;
  ttl?: number;
}

export interface HistoryCursorItem {
  kid: number;
  avid?: number;
  bvid: string;
  cid?: number;
  title: string;
  author_name: string;
  author_mid: number;
  view_at: number;
  progress: number;
  duration: number;
  business: string;
  cover: string;
  tag_name: string;
  tags: string;
  device?: number;
  is_fav: number;
  dt: number;
  history?: {
    oid?: number;
    bvid?: string;
    cid?: number;
    dt?: number;
    business?: string;
  };
}

export interface HistoryCursorData {
  cursor: {
    max: number;
    view_at: number;
    business: string;
    ps: number;
    has_more?: boolean;
  };
  list: HistoryCursorItem[];
}
