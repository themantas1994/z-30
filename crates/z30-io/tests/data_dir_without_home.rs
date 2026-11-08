//! With no HOME or USERPROFILE (a service, cron, `env -i`), the data directory used to be
//! `./.z30`: the configuration was read from, and written to, wherever the program was started.
//!
//! This test changes its own process environment, so it is alone in this test binary: no other
//! thread reads the environment while it runs.

use z30_io::paths::{config_path, data_dir, logbook_path};

#[test]
fn without_home_variables_the_data_directory_is_the_accounts_home_not_the_current_directory() {
    for k in ["Z30_HOME", "XDG_CONFIG_HOME", "HOME", "USERPROFILE"] {
        std::env::remove_var(k);
    }
    let Some(home) = std::env::home_dir().filter(|h| h.is_absolute()) else {
        eprintln!("not checked: the system records no home directory for this account");
        return;
    };
    assert_eq!(data_dir(), home.join(".z30"));
    assert!(config_path().is_absolute(), "{}", config_path().display());
    assert!(logbook_path().is_absolute(), "{}", logbook_path().display());
}
