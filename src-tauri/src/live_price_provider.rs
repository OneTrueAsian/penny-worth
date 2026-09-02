//! The single active live-price data provider — only one of these is ever
//! configured at a time, sharing the one `api_key` column in
//! `live_price_settings` (see `Store::set_live_price_settings`). Lets
//! `commands.rs`'s `fetch_live_quote`/`refresh_live_prices` dispatch to
//! whichever module without branching logic sprinkled through them.
use rust_decimal::Decimal;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LivePriceProvider {
    AlphaVantage,
    Finnhub,
    TwelveData,
}

impl LivePriceProvider {
    /// The DB/wire identifier — what's stored in `live_price_settings.provider`
    /// and sent to/from the frontend. Mirrors `AccountType::as_str`
    /// (core/src/models.rs) for consistency with this codebase's existing
    /// "plain string crosses the core/src-tauri boundary" convention.
    pub fn as_str(self) -> &'static str {
        match self {
            LivePriceProvider::AlphaVantage => "alpha_vantage",
            LivePriceProvider::Finnhub => "finnhub",
            LivePriceProvider::TwelveData => "twelve_data",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "alpha_vantage" => Some(LivePriceProvider::AlphaVantage),
            "finnhub" => Some(LivePriceProvider::Finnhub),
            "twelve_data" => Some(LivePriceProvider::TwelveData),
            _ => None,
        }
    }

    /// User-facing display name, for error/status messages.
    pub fn label(self) -> &'static str {
        match self {
            LivePriceProvider::AlphaVantage => "Alpha Vantage",
            LivePriceProvider::Finnhub => "Finnhub",
            LivePriceProvider::TwelveData => "Twelve Data",
        }
    }

    /// This provider's confirmed daily request cap, or `None` when it has
    /// no daily cap to enforce (Finnhub — a real per-*minute* limit, not a
    /// per-day one). The single source of truth for which providers get a
    /// proactive local hard-stop; `commands.rs`'s `get_live_price_settings`,
    /// `fetch_live_quote`, and `refresh_live_prices` all read this instead
    /// of each re-deriving it.
    pub fn daily_limit(self) -> Option<i64> {
        match self {
            LivePriceProvider::AlphaVantage => Some(crate::live_prices::ALPHA_VANTAGE_DAILY_LIMIT),
            LivePriceProvider::Finnhub => None,
            LivePriceProvider::TwelveData => Some(crate::twelve_data::TWELVE_DATA_DAILY_LIMIT),
        }
    }
}

/// Dispatches to whichever provider's own `fetch_quote`.
pub async fn fetch_quote(
    provider: LivePriceProvider,
    client: &reqwest::Client,
    api_key: &str,
    symbol: &str,
) -> Result<Option<Decimal>, String> {
    match provider {
        LivePriceProvider::AlphaVantage => crate::live_prices::fetch_quote(client, api_key, symbol).await,
        LivePriceProvider::Finnhub => crate::finnhub::fetch_quote(client, api_key, symbol).await,
        LivePriceProvider::TwelveData => crate::twelve_data::fetch_quote(client, api_key, symbol).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [LivePriceProvider; 3] =
        [LivePriceProvider::AlphaVantage, LivePriceProvider::Finnhub, LivePriceProvider::TwelveData];

    #[test]
    fn as_str_and_parse_round_trip_for_every_provider() {
        for p in ALL {
            assert_eq!(LivePriceProvider::parse(p.as_str()), Some(p));
        }
    }

    #[test]
    fn parse_returns_none_for_an_unknown_provider_string() {
        assert_eq!(LivePriceProvider::parse("yahoo_finance"), None);
    }

    #[test]
    fn parse_is_case_insensitive() {
        assert_eq!(LivePriceProvider::parse("FINNHUB"), Some(LivePriceProvider::Finnhub));
        assert_eq!(LivePriceProvider::parse("TWELVE_DATA"), Some(LivePriceProvider::TwelveData));
    }

    #[test]
    fn daily_limit_is_only_none_for_finnhub() {
        assert_eq!(LivePriceProvider::AlphaVantage.daily_limit(), Some(25));
        assert_eq!(LivePriceProvider::Finnhub.daily_limit(), None);
        assert_eq!(LivePriceProvider::TwelveData.daily_limit(), Some(800));
    }
}
