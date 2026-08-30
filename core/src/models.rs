use chrono::NaiveDate;
use rust_decimal::Decimal;

/// A single imported transaction. `amount` is negative for money out,
/// positive for money in — matching how bank CSV exports represent it.
#[derive(Debug, Clone, PartialEq)]
pub struct Transaction {
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountType {
    Checking,
    Savings,
    Credit,
    Loan,
    Investment,
    Other,
}

impl AccountType {
    pub fn as_str(self) -> &'static str {
        match self {
            AccountType::Checking => "checking",
            AccountType::Savings => "savings",
            AccountType::Credit => "credit",
            AccountType::Loan => "loan",
            AccountType::Investment => "investment",
            AccountType::Other => "other",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "checking" => Some(AccountType::Checking),
            "savings" => Some(AccountType::Savings),
            "credit" => Some(AccountType::Credit),
            "loan" => Some(AccountType::Loan),
            "investment" => Some(AccountType::Investment),
            "other" => Some(AccountType::Other),
            _ => None,
        }
    }

    /// Which dashboard/net-worth group this account type belongs in —
    /// Checking/Savings are cash you have; Credit/Loan are debt (their
    /// `current_balance` is "available", not a balance — see
    /// `Store::list_accounts`); Investment and Other are their own groups.
    pub fn group(self) -> &'static str {
        match self {
            AccountType::Checking | AccountType::Savings => "cash",
            AccountType::Credit => "credit",
            AccountType::Loan => "loan",
            AccountType::Investment => "investment",
            AccountType::Other => "other",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_account_type_round_trips_through_as_str_and_parse() {
        let all = [
            AccountType::Checking,
            AccountType::Savings,
            AccountType::Credit,
            AccountType::Loan,
            AccountType::Investment,
            AccountType::Other,
        ];
        for t in all {
            assert_eq!(AccountType::parse(t.as_str()), Some(t));
        }
    }

    #[test]
    fn account_type_groups_map_as_expected() {
        assert_eq!(AccountType::Checking.group(), "cash");
        assert_eq!(AccountType::Savings.group(), "cash");
        assert_eq!(AccountType::Credit.group(), "credit");
        assert_eq!(AccountType::Loan.group(), "loan");
        assert_eq!(AccountType::Investment.group(), "investment");
        assert_eq!(AccountType::Other.group(), "other");
    }
}

/// A named account (e.g. "Everyday Checking") that imported transactions
/// belong to.
#[derive(Debug, Clone, PartialEq)]
pub struct Account {
    pub name: String,
    pub account_type: AccountType,
}
