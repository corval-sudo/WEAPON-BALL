// src/services/twitter.ts
// Send-only X/Twitter integration for the WORBZ Arena.
// Posts tournament final videos with LLM-generated captions.
//
// Enable via admin CLI (requires ADMIN_SECRET):
//   npm run admin set x_api_key              "your-api-key"
//   npm run admin set x_api_secret           "your-api-secret"
//   npm run admin set x_access_token         "your-access-token"
//   npm run admin set x_access_token_secret  "your-access-token-secret"
//   npm run admin set x_enabled              "true"
//
// When x_enabled is "false" (default), all methods silently no-op.
// X posting errors are caught and logged — they never crash the scheduler.

import { TwitterApi } from "twitter-api-v2";
import type { Tournament } from "../data/types";

export class TwitterService {
  private client: TwitterApi | null;
  private enabled: boolean;

  constructor(
    apiKey: string,
    apiSecret: string,
    accessToken: string,
    accessTokenSecret: string,
    enabled: boolean,
  ) {
    this.enabled = enabled && !!apiKey && !!apiSecret && !!accessToken && !!accessTokenSecret;
    this.client = this.enabled
      ? new TwitterApi({
          appKey: apiKey,
          appSecret: apiSecret,
          accessToken,
          accessSecret: accessTokenSecret,
        })
      : null;
  }

  /**
   * Post a tournament final video with caption to X.
   * Uses chunked media upload for video files.
   * Returns the tweet ID on success, or null on failure/disabled.
   */
  async postTournamentFinal(
    mp4Path: string,
    caption: string,
    tournament: Tournament,
  ): Promise<string | null> {
    if (!this.enabled || !this.client) return null;

    try {
      // Upload video via chunked media upload
      const mediaId = await this.client.v1.uploadMedia(mp4Path, {
        mimeType: "video/mp4",
        target: "tweet",
        longVideo: true,
      });

      // Post the tweet with the uploaded media
      const tweet = await this.client.v2.tweet({
        text: caption,
        media: { media_ids: [mediaId] },
      });

      console.log(`[X] Posted tournament #${tournament.id} final — tweet ${tweet.data.id}`);
      return tweet.data.id;
    } catch (e: any) {
      // Never crash the scheduler
      console.warn(`[X] Video post failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Post a text-only tweet (fallback when video recording fails).
   */
  async postText(text: string): Promise<string | null> {
    if (!this.enabled || !this.client) return null;
    try {
      const tweet = await this.client.v2.tweet({ text });
      console.log(`[X] Text post — tweet ${tweet.data.id}`);
      return tweet.data.id;
    } catch (e: any) {
      console.warn(`[X] Text post failed: ${e.message}`);
      return null;
    }
  }
}
