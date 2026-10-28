/**
 * Which journey each labelled intent from the Wisdom dataset leads to. An
 * intent missing from this map has no route: the coordinator keeps handling
 * it (slot answers, confirmations, anything ambiguous).
 */
export type ConnectRoute =
  | "search" | "buy" | "sell" | "jobs" | "houses" | "read_reviews" | "write_review"
  | "add_business" | "scam" | "feedback" | "menu" | "social" | "community";

export const INTENT_ROUTE: Readonly<Record<string, ConnectRoute>> = {
  find_service: "search", find_business: "search", local_info: "search", business_hours: "search",
  business_address: "search", business_contact: "search", business_price: "search", price_or_quote: "search",
  item_price_check: "search", availability: "search", compare_options: "search",
  buy_item: "buy", property_buy: "houses",
  sell_item: "sell",
  job_seek: "jobs", gig_work: "jobs", cv_help: "jobs", interview_help: "jobs", job_post_recruit: "jobs",
  rent_seek: "houses", rent_list: "houses", property_sell: "houses",
  business_reviews: "read_reviews",
  write_review: "write_review", rate_business: "write_review", complaint_about_business: "write_review",
  add_business: "add_business", contribute_provider_details: "add_business", contribute: "add_business",
  job_scam_check: "scam",
  feedback_bot: "feedback", suggestion: "feedback", bug_report: "feedback", info_wrong: "feedback",
  correction: "feedback", correct_business: "feedback", request_human: "feedback",
  greeting: "menu", show_menu: "menu", help: "menu", cancel_or_restart: "menu",
  thanks: "social", goodbye: "social", smalltalk: "social", humour_request: "social",
  ask_community: "community",
};
