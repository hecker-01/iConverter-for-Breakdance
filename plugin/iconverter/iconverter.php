<?php
/**
 * Plugin Name: iConverter
 * Description: Converts SVG artwork to clean, black path-only SVG files.
 * Version: 0.3.6
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: heckr.dev
 * Author URI: https://heckr.dev
 * Text Domain: iconverter
 * Domain Path: /languages
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ICONVERTER_VERSION', '0.3.6' );

/** Load plugin translations. */
function iconverter_load_textdomain() {
	load_plugin_textdomain( 'iconverter', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
}
add_action( 'init', 'iconverter_load_textdomain' );

/** Register front-end assets. */
function iconverter_register_assets() {
	$base_url = plugin_dir_url( __FILE__ );

	wp_register_style( 'iconverter', $base_url . 'assets/css/converter.css', array(), ICONVERTER_VERSION );
	wp_register_script( 'iconverter-pathkit', $base_url . 'assets/js/pathkit.js', array(), '1.0.0', true );
	wp_register_script(
		'iconverter',
		$base_url . 'assets/js/converter.min.js',
		array( 'iconverter-pathkit' ),
		ICONVERTER_VERSION,
		true
	);
}
add_action( 'wp_enqueue_scripts', 'iconverter_register_assets' );

/**
 * Get translated browser-interface strings.
 *
 * @return array<string, string>
 */
function iconverter_get_strings() {
	return array(
		'loading'               => __( 'Loading converter…', 'iconverter' ),
		'heading'               => __( 'SVG converter', 'iconverter' ),
		'intro'                 => __( 'Drop SVG files or a ZIP archive here.', 'iconverter' ),
		'dropLabel'             => __( 'Drop SVG or ZIP files here', 'iconverter' ),
		'browse'                => __( 'Browse files', 'iconverter' ),
		'renameHeading'         => __( 'Rename output files', 'iconverter' ),
		'removeLabel'           => __( 'Remove matching text', 'iconverter' ),
		'removePlaceholder'     => __( 'Text or regular expression', 'iconverter' ),
		'regexLabel'            => __( 'Use regular expression', 'iconverter' ),
		'prefixLabel'           => __( 'Add prefix', 'iconverter' ),
		'suffixLabel'           => __( 'Add suffix', 'iconverter' ),
		'prefixPlaceholder'     => __( 'Prefix', 'iconverter' ),
		'suffixPlaceholder'     => __( 'Suffix', 'iconverter' ),
		'sourceName'            => __( 'Source file', 'iconverter' ),
		'outputName'            => __( 'Output file', 'iconverter' ),
		'status'                => __( 'Status', 'iconverter' ),
		'progress'              => __( 'Conversion progress', 'iconverter' ),
		'processed'             => __( '%1$d of %2$d processed', 'iconverter' ),
		'moreInfo'              => __( 'More info', 'iconverter' ),
		'hideInfo'              => __( 'Hide info', 'iconverter' ),
		'failureReason'         => __( 'Failure reason', 'iconverter' ),
		'actions'               => __( 'Actions', 'iconverter' ),
		'queued'                => __( 'Queued', 'iconverter' ),
		'converting'            => __( 'Converting', 'iconverter' ),
		'complete'              => __( 'Complete', 'iconverter' ),
		'failed'                => __( 'Failed', 'iconverter' ),
		'download'              => __( 'Download SVG', 'iconverter' ),
		'downloadAll'           => __( 'Download all', 'iconverter' ),
		'retry'                 => __( 'Retry failed', 'iconverter' ),
		'clear'                 => __( 'Clear all', 'iconverter' ),
		'invalidRegex'          => __( 'Invalid regular expression: %s', 'iconverter' ),
		'loadFailure'           => __( 'The conversion engine could not be loaded.', 'iconverter' ),
		'unsupportedFile'       => __( 'Only SVG and ZIP files are supported.', 'iconverter' ),
		'emptyArchive'          => __( 'The ZIP archive does not contain any SVG files.', 'iconverter' ),
		'encryptedArchive'      => __( 'Encrypted ZIP archives are not supported.', 'iconverter' ),
		'nestedArchive'         => __( 'Nested ZIP archives are not supported.', 'iconverter' ),
		'unsafeArchive'         => __( 'The ZIP archive is invalid or unsafe.', 'iconverter' ),
		'noFiles'               => __( 'Choose at least one SVG or ZIP file.', 'iconverter' ),
		'completedAnnouncement' => __( '%1$d files completed; %2$d failed.', 'iconverter' ),
		'malformedSvg'          => __( 'The file is not valid SVG XML.', 'iconverter' ),
		'invalidViewBox'        => __( 'The SVG needs a valid viewBox or numeric width and height.', 'iconverter' ),
		'invalidAttribute'      => __( 'The SVG contains an invalid attribute value.', 'iconverter' ),
		'invalidTransform'      => __( 'The SVG contains an invalid transform.', 'iconverter' ),
		'invalidShape'          => __( 'The SVG contains invalid shape geometry.', 'iconverter' ),
		'invalidPath'           => __( 'A path could not be converted.', 'iconverter' ),
		'unsupportedElement'    => __( 'The SVG contains an unsupported element.', 'iconverter' ),
		'unsupportedAttribute'  => __( 'The SVG contains an unsupported visual attribute.', 'iconverter' ),
		'unsupportedStyle'      => __( 'The SVG contains unsupported CSS.', 'iconverter' ),
		'unsafeContent'         => __( 'The SVG contains unsafe active content.', 'iconverter' ),
		'externalReference'     => __( 'External and URL references are not supported.', 'iconverter' ),
		'partialOpacity'        => __( 'Partial opacity cannot be converted to solid black paths.', 'iconverter' ),
		'dashedStroke'          => __( 'Dashed strokes are not supported.', 'iconverter' ),
		'emptyGeometry'         => __( 'The SVG does not contain visible supported geometry.', 'iconverter' ),
		'engineUnavailable'     => __( 'The conversion engine is unavailable.', 'iconverter' ),
	);
}

/**
 * Render the converter application.
 *
 * @return string
 */
function iconverter_render_converter() {
	static $instance = 0;
	$instance++;

	wp_enqueue_style( 'iconverter' );
	wp_enqueue_script( 'iconverter' );

	$config = wp_json_encode(
		array(
			'wasmUrl'    => plugin_dir_url( __FILE__ ) . 'assets/wasm/pathkit.wasm',
			'pathkitUrl' => plugin_dir_url( __FILE__ ) . 'assets/js/pathkit.js',
			'workerUrl'  => plugin_dir_url( __FILE__ ) . 'assets/js/converter-worker.min.js',
			'strings' => iconverter_get_strings(),
		),
		JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
	);

	return sprintf(
		'<div id="iconverter-%1$d" class="iconverter-app" data-iconverter><script type="application/json" data-iconverter-config>%2$s</script><p class="iconverter-loading" role="status">%3$s</p></div>',
		$instance,
		$config,
		esc_html__( 'Loading converter…', 'iconverter' )
	);
}

add_shortcode( 'converter', 'iconverter_render_converter' );
