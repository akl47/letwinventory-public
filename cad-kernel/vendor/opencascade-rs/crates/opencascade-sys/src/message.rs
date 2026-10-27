pub use inner::*;

#[cxx::bridge]
mod inner {
    unsafe extern "C++" {
        include!("opencascade-sys/include/message.hxx");
        include!("opencascade-sys/include/bindings_common.hxx");

        type Message_ProgressRange;
        #[cxx_name = "construct_unique"]
        pub fn Message_ProgressRange_new() -> UniquePtr<Message_ProgressRange>;

        /// Install a C++ std::terminate handler that logs the active
        /// exception (Standard_Failure / std::exception / unknown) to
        /// stderr before aborting. Call once at kernel startup. Doesn't
        /// prevent the abort, but gives us a "what()" string for the
        /// uncaught throw so we can diagnose which OCCT call to wrap
        /// in try_construct_unique next.
        pub fn install_terminate_handler();
    }
}
