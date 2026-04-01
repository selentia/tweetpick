const DEFAULT_RETWEETERS_FEATURES = Object.freeze({
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
});

const DEFAULT_TWEET_DETAIL_FIELD_TOGGLES = Object.freeze({
  withArticleRichContentState: true,
  withArticlePlainText: false,
  withArticleSummaryText: false,
  withArticleVoiceOver: false,
  withGrokAnalyze: false,
  withDisallowedReplyControls: false,
});

const REQUIRED_TWITTER_ENV_VARS = Object.freeze({
  bearerToken: 'TWITTER_BEARER',
  retweetersOperationId: 'TWITTER_RETWEETERS_OP_ID',
  searchTimelineOperationId: 'TWITTER_SEARCH_TIMELINE_OP_ID',
  tweetDetailOperationId: 'TWITTER_TWEET_DETAIL_OP_ID',
});

const OPTIONAL_TWITTER_ENV_VARS = Object.freeze({
  favoritersOperationId: 'TWITTER_FAVORITERS_OP_ID',
});

type JsonObject = Record<string, unknown>;

interface TwitterConfigOptions {
  bearerToken?: string;
  retweetersOperationId?: string;
  favoritersOperationId?: string;
  searchTimelineOperationId?: string;
  tweetDetailOperationId?: string;
  operationId?: string;
  featuresJson?: string | JsonObject;
  fieldTogglesJson?: string | JsonObject;
}

interface TwitterConfig {
  bearerToken: string;
  operationId: string;
  retweetersOperationId: string;
  favoritersOperationId: string;
  searchTimelineOperationId: string;
  tweetDetailOperationId: string;
  features: JsonObject;
  fieldToggles: JsonObject;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseFeaturesJson(featuresInput: string | JsonObject, sourceLabel: string): JsonObject {
  if (typeof featuresInput === 'object' && featuresInput !== null && !Array.isArray(featuresInput)) {
    return featuresInput;
  }

  try {
    const parsed = JSON.parse(String(featuresInput));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('features must be a JSON object.');
    }
    return parsed;
  } catch {
    throw new Error(`Failed to parse ${sourceLabel}. Provide a valid JSON object string.`);
  }
}

function resolveTwitterConfig(options: TwitterConfigOptions = {}): TwitterConfig {
  const {
    bearerToken: bearerTokenOverride,
    retweetersOperationId: retweetersOperationIdOverride,
    favoritersOperationId: favoritersOperationIdOverride,
    searchTimelineOperationId: searchTimelineOperationIdOverride,
    tweetDetailOperationId: tweetDetailOperationIdOverride,
    operationId: operationIdOverride,
    featuresJson: featuresJsonOverride,
    fieldTogglesJson: fieldTogglesJsonOverride,
  } = options;

  const bearerToken =
    readNonEmptyString(bearerTokenOverride) || readNonEmptyString(process.env[REQUIRED_TWITTER_ENV_VARS.bearerToken]);
  const retweetersOperationId =
    readNonEmptyString(retweetersOperationIdOverride) ||
    readNonEmptyString(operationIdOverride) ||
    readNonEmptyString(process.env[REQUIRED_TWITTER_ENV_VARS.retweetersOperationId]);
  const favoritersOperationId =
    readNonEmptyString(favoritersOperationIdOverride) ||
    readNonEmptyString(process.env[OPTIONAL_TWITTER_ENV_VARS.favoritersOperationId]) ||
    retweetersOperationId;
  const searchTimelineOperationId =
    readNonEmptyString(searchTimelineOperationIdOverride) ||
    readNonEmptyString(process.env[REQUIRED_TWITTER_ENV_VARS.searchTimelineOperationId]);
  const tweetDetailOperationId =
    readNonEmptyString(tweetDetailOperationIdOverride) ||
    readNonEmptyString(process.env[REQUIRED_TWITTER_ENV_VARS.tweetDetailOperationId]);

  const missingEnvVars: string[] = [];
  if (!bearerToken) {
    missingEnvVars.push(REQUIRED_TWITTER_ENV_VARS.bearerToken);
  }
  if (!retweetersOperationId) {
    missingEnvVars.push(REQUIRED_TWITTER_ENV_VARS.retweetersOperationId);
  }
  if (!searchTimelineOperationId) {
    missingEnvVars.push(REQUIRED_TWITTER_ENV_VARS.searchTimelineOperationId);
  }
  if (!tweetDetailOperationId) {
    missingEnvVars.push(REQUIRED_TWITTER_ENV_VARS.tweetDetailOperationId);
  }

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing required Twitter configuration: ${missingEnvVars.join(
        ', '
      )}. Create a .env file from .env.example or pass explicit overrides to resolveTwitterConfig(options).`
    );
  }

  let features: JsonObject = DEFAULT_RETWEETERS_FEATURES;
  if (featuresJsonOverride) {
    features = parseFeaturesJson(featuresJsonOverride, '--features-json');
  } else if (process.env.TWITTER_RETWEETERS_FEATURES_JSON) {
    features = parseFeaturesJson(process.env.TWITTER_RETWEETERS_FEATURES_JSON, 'TWITTER_RETWEETERS_FEATURES_JSON');
  }

  let fieldToggles: JsonObject = DEFAULT_TWEET_DETAIL_FIELD_TOGGLES;
  if (fieldTogglesJsonOverride) {
    fieldToggles = parseFeaturesJson(fieldTogglesJsonOverride, '--field-toggles-json');
  } else if (process.env.TWITTER_TWEET_DETAIL_FIELD_TOGGLES_JSON) {
    fieldToggles = parseFeaturesJson(
      process.env.TWITTER_TWEET_DETAIL_FIELD_TOGGLES_JSON,
      'TWITTER_TWEET_DETAIL_FIELD_TOGGLES_JSON'
    );
  }

  return {
    bearerToken: bearerToken!,
    operationId: retweetersOperationId!,
    retweetersOperationId: retweetersOperationId!,
    favoritersOperationId: favoritersOperationId!,
    searchTimelineOperationId: searchTimelineOperationId!,
    tweetDetailOperationId: tweetDetailOperationId!,
    features,
    fieldToggles,
  };
}

export {
  DEFAULT_RETWEETERS_FEATURES,
  DEFAULT_TWEET_DETAIL_FIELD_TOGGLES,
  REQUIRED_TWITTER_ENV_VARS,
  resolveTwitterConfig,
};
export type { TwitterConfig, TwitterConfigOptions };
