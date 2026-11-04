export interface StoryCoordinates {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

export interface StoryClickableLink {
  url: string;
  checkResult?: number | null;
}

export interface StoryLayer {
  type?: number;
  coordinates: StoryCoordinates;
  clickableLink: StoryClickableLink;
}

export interface StoryOwner {
  ownerId: number;
  type?: number;
}

export interface StoryMedia {
  _type: "PHOTO" | "VIDEO";
  photoToken?: string;
  token?: string;
  videoType?: number;
  duration?: number;
  baseUrl?: string;
  url?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  previewData?: string;
}

export interface StoryItem {
  id?: number;
  cid?: number;
  media: StoryMedia;
  layers?: StoryLayer[];
  settings?: number;
  expiration?: number;
}

export interface StoryPreview {
  owner: StoryOwner;
  totalCount: number;
  readCount: number;
  lastStoryExpirationTime: number;
  settings: number;
  updateTime: number;
}

export interface StoriesApiMethods {
  getStoriesFeed(cursor?: string, count?: number): Promise<{ storiesPreviews: StoryPreview[]; cursor: string }>;
  getStoriesByOwners(owners: StoryOwner | StoryOwner[]): Promise<{ peerStories: Array<{ owner: StoryOwner; stories: StoryItem[] }>; storiesPreviews?: StoryPreview[] }>;
  getStoriesById(owner: StoryOwner, storyIds: number[]): Promise<{ stories: StoryItem[] }>;
  getStoryStats(storyId: number): Promise<any>;
  getStoryDetailedStats(storyId: number, filter?: number, marker?: number): Promise<{ storyDetailedStats: Array<{ userId: number; reaction?: any }>; marker: number }>;
  reactStory(owner: StoryOwner, storyId: number, reaction?: string | { id: string; reactionType: number } | null): Promise<{ success: boolean }>;
  readStory(owner: StoryOwner, storyId: number): Promise<{ success: boolean }>;
  sendStory(storiesPayload: any | any[]): Promise<{ stories: StoryItem[]; storiesPreview?: StoryPreview }>;
  editStory(storyId: number, settings: number): Promise<{ story: StoryItem }>;
  deleteStories(storyIds: number | number[]): Promise<{ success: boolean }>;
  requestStoryPhotoUpload(count?: number): Promise<{ url: string }>;
  requestStoryVideoUpload(count?: number): Promise<{ info: Array<{ url: string; videoId: number; token: string }> }>;
  uploadStoryPhoto(filePath: string, fileName?: string): Promise<string>;
  uploadStoryVideo(filePath: string, durationMs: number, fileName?: string): Promise<{ token: string; videoId: number; duration: number }>;
  publishPhotoStory(options: { photoToken: string; settings?: number; expiration?: number; layers?: StoryLayer[] }): Promise<any>;
  publishVideoStory(options: { videoToken: string; durationMs: number; settings?: number; expiration?: number; layers?: StoryLayer[] }): Promise<any>;
  handleStoryPush(payload: any): void;
}

declare class MobileApi implements StoriesApiMethods {
  getStoriesFeed(cursor?: string, count?: number): Promise<{ storiesPreviews: StoryPreview[]; cursor: string }>;
  getStoriesByOwners(owners: StoryOwner | StoryOwner[]): Promise<{ peerStories: Array<{ owner: StoryOwner; stories: StoryItem[] }>; storiesPreviews?: StoryPreview[] }>;
  getStoriesById(owner: StoryOwner, storyIds: number[]): Promise<{ stories: StoryItem[] }>;
  getStoryStats(storyId: number): Promise<any>;
  getStoryDetailedStats(storyId: number, filter?: number, marker?: number): Promise<{ storyDetailedStats: Array<{ userId: number; reaction?: any }>; marker: number }>;
  reactStory(owner: StoryOwner, storyId: number, reaction?: string | { id: string; reactionType: number } | null): Promise<{ success: boolean }>;
  readStory(owner: StoryOwner, storyId: number): Promise<{ success: boolean }>;
  sendStory(storiesPayload: any | any[]): Promise<{ stories: StoryItem[]; storiesPreview?: StoryPreview }>;
  editStory(storyId: number, settings: number): Promise<{ story: StoryItem }>;
  deleteStories(storyIds: number | number[]): Promise<{ success: boolean }>;
  requestStoryPhotoUpload(count?: number): Promise<{ url: string }>;
  requestStoryVideoUpload(count?: number): Promise<{ info: Array<{ url: string; videoId: number; token: string }> }>;
  uploadStoryPhoto(filePath: string, fileName?: string): Promise<string>;
  uploadStoryVideo(filePath: string, durationMs: number, fileName?: string): Promise<{ token: string; videoId: number; duration: number }>;
  publishPhotoStory(options: { photoToken: string; settings?: number; expiration?: number; layers?: StoryLayer[] }): Promise<any>;
  publishVideoStory(options: { videoToken: string; durationMs: number; settings?: number; expiration?: number; layers?: StoryLayer[] }): Promise<any>;
  handleStoryPush(payload: any): void;

  sendMessage(message: any, chatId: any, params?: any): Promise<any>;
  getMessages(chatId: any, from_time?: any, backward?: number, forward?: number): Promise<any>;
  deleteMessage(chatId: any, messageId: any, forMe?: boolean): Promise<any>;
  editMessage(chatId: any, messageId: any, text: string, attaches?: any[], elements?: any[]): Promise<any>;
  sync(): Promise<any>;
  init(forceSync?: boolean, isReconnect?: boolean): Promise<boolean>;
  logout(userId?: any, redirect?: boolean): Promise<any>;
}

export default MobileApi;
