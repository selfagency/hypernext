#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        // Presence test; a non-constant assert keeps clippy's
        // `assertions_on_constants` (edition-2024 toolchain) happy.
        assert_eq!(1 + 1, 2);
    }
}
