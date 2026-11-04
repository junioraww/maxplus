import { invoke } from "$lib/utils/invoke";
import { pluginEmit } from "$lib/plugins/events";
import { updateStoryPreviewFromPush } from "$lib/stores/stories";

function normalizeStoryOwner(o) {
  return {
    ownerId: Number(o?.ownerId ?? o?.id ?? o),
    type: Number(o?.type ?? o?.ownerType ?? 0)
  };
}

export const storiesApiMixin = {
  async getStoriesFeed(cursor = "0", count = 20) {
    return await invoke("get_stories_feed", { cursor: String(cursor || "0"), count: Number(count) });
  },

  async getStoriesByOwners(owners) {
    const list = Array.isArray(owners) ? owners : [owners];
    return await invoke("get_stories_by_owners", { owners: list.map(normalizeStoryOwner) });
  },

  async getStoriesById(owner, storyIds) {
    const ids = (Array.isArray(storyIds) ? storyIds : [storyIds]).map(Number);
    return await invoke("get_stories_by_id", { owner: normalizeStoryOwner(owner), storyIds: ids });
  },

  async getStoryStats(storyId) {
    return await invoke("get_story_stats", { storyId: Number(storyId) });
  },

  async getStoryDetailedStats(storyId, filter = 0, marker = 0) {
    return await invoke("get_story_detailed_stats", {
      storyId: Number(storyId),
      filter: Number(filter),
      marker: Number(marker)
    });
  },

  async reactStory(owner, storyId, reaction = null) {
    const reactionPayload = reaction
      ? (typeof reaction === "string" ? { id: reaction, reactionType: 0 } : reaction)
      : null;
    return await invoke("react_story", {
      owner: normalizeStoryOwner(owner),
      storyId: Number(storyId),
      reaction: reactionPayload
    });
  },

  async readStory(owner, storyId) {
    return await invoke("mark_story_read", {
      owner: normalizeStoryOwner(owner),
      storyId: Number(storyId)
    });
  },

  async sendStory(storiesPayload) {
    const payload = Array.isArray(storiesPayload) ? storiesPayload : [storiesPayload];
    return await invoke("send_story", { stories: payload });
  },

  async editStory(storyId, settings) {
    return await invoke("edit_story", {
      storyId: Number(storyId),
      settings: Number(settings)
    });
  },

  async deleteStories(storyIds) {
    const ids = (Array.isArray(storyIds) ? storyIds : [storyIds]).map(Number);
    return await invoke("delete_stories", { storyIds: ids });
  },

  async requestStoryPhotoUpload(count = 1) {
    return await invoke("get_story_photo_upload", { count: Number(count) });
  },

  async requestStoryVideoUpload(count = 1) {
    return await invoke("get_story_video_upload", { count: Number(count) });
  },

  async uploadStoryPhoto(filePath, fileName = "story.jpg") {
    const uploadInfo = await this.requestStoryPhotoUpload(1);
    const uploadUrl = uploadInfo?.url || uploadInfo?.info?.[0]?.url;
    if (!uploadUrl) {
      throw new Error("Failed to get story photo upload url");
    }
    const result = await invoke("upload", {
      uploadUrl,
      path: filePath,
      attachType: "PHOTO",
      fileName
    });
    if (result?.error) {
      throw new Error(result.error);
    }
    let token = (typeof result === "string" ? result : null) ||
      result?.token ||
      result?.photoToken ||
      (Array.isArray(result) ? result[0]?.token : null);
    if (!token && result?.photos && typeof result.photos === "object") {
      for (const entry of Object.values(result.photos)) {
        if (entry && typeof entry === "object" && entry.token) {
          token = String(entry.token);
          break;
        }
      }
    }
    if (!token) {
      throw new Error("Failed to receive story photo upload token");
    }
    return token;
  },

  async uploadStoryVideo(filePath, durationMs, fileName = "story.mp4") {
    const uploadResp = await this.requestStoryVideoUpload(1);
    const info = uploadResp?.info?.[0] || uploadResp;
    if (!info?.url) {
      throw new Error("Failed to get story video upload url");
    }
    const videoId = info.videoId !== undefined ? Number(info.videoId) : undefined;
    const result = await invoke("upload", {
      uploadUrl: info.url,
      path: filePath,
      attachType: "VIDEO",
      videoId,
      token: info.token,
      fileName
    });
    if (result?.error) {
      throw new Error(result.error);
    }
    const token = (typeof result === "string" ? result : null) ||
      result?.token ||
      result?.videoToken ||
      (Array.isArray(result) ? result[0]?.token : null) ||
      info.token;
    return {
      token,
      videoId,
      duration: Number(durationMs || 0)
    };
  },

  async publishPhotoStory({ photoToken, settings = 1, expiration = 86400000, layers = [] }) {
    const cid = Date.now();
    const storyItem = {
      cid,
      settings: Number(settings),
      expiration: Number(expiration),
      media: {
        _type: "PHOTO",
        photoToken
      }
    };
    if (Array.isArray(layers) && layers.length > 0) {
      storyItem.layers = layers;
    }
    const response = await this.sendStory([storyItem]);
    pluginEmit("story:published", { type: "photo", cid, response });
    return response;
  },

  async publishVideoStory({ videoToken, durationMs, settings = 1, expiration = 86400000, layers = [], isMuted = false }) {
    const cid = Date.now();
    const storyItem = {
      cid,
      settings: Number(settings),
      expiration: Number(expiration),
      media: {
        _type: "VIDEO",
        videoType: 2,
        token: videoToken,
        duration: Math.round(Number(durationMs)),
        ...(isMuted ? { isMuted: true, mute: true } : {})
      }
    };
    if (Array.isArray(layers) && layers.length > 0) {
      storyItem.layers = layers;
    }
    const response = await this.sendStory([storyItem]);
    pluginEmit("story:published", { type: "video", cid, response });
    return response;
  },

  handleStoryPush(payload) {
    if (!payload) return;
    const preview = payload.storiesPreview || payload;
    if (preview && preview.owner) {
      updateStoryPreviewFromPush(preview);
      pluginEmit("story:update", preview);
    }
  }
};
