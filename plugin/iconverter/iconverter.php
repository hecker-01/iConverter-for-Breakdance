<?php
/**
 * Plugin Name: iConverter for Breakdance
 * Plugin URI: https://github.com/hecker-01/iconverter
 * Description: Converts Breakdance icon uploads to clean, black path-only SVGs.
 * Version: 1.0.1
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: hecker-01
 * Author URI: https://heckr.dev
 * Text Domain: iconverter
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ICONVERTER_VERSION', '1.0.1' );

/**
 * Register and enqueue Breakdance Builder integration scripts.
 */
function iconverter_register_breakdance_builder_assets() {
	$base_url = plugin_dir_url( __FILE__ );

	wp_register_script( 'iconverter-pathkit', $base_url . 'assets/js/pathkit.js', array(), '1.0.0', true );
	wp_register_script(
		'iconverter-breakdance',
		$base_url . 'assets/js/breakdance.min.js',
		array( 'iconverter-pathkit' ),
		ICONVERTER_VERSION,
		true
	);

	$config = array(
		'wasmUrl'    => $base_url . 'assets/wasm/pathkit.wasm',
	);

	wp_localize_script( 'iconverter-breakdance', 'iconverterBreakdanceConfig', $config );
	wp_enqueue_script( 'iconverter-breakdance' );
	wp_print_scripts( array( 'iconverter-breakdance' ) );
}
add_action( 'breakdance_builder_footer', 'iconverter_register_breakdance_builder_assets' );
