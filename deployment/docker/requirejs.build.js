// r.js build profile for the map page bundle (bims/static/js/optimized.js).
// Paths are relative to this file. Run from the Dockerfile; see
// bims/templatetags/grunt.py for how the bundle is served.
({
    baseUrl: '../../bims/static/js',
    mainConfigFile: '../../bims/static/js/app.js',
    name: 'libs/almond/almond',
    include: ['app.js'],
    out: '../../bims/static/js/optimized.js',
    // App code uses ES2015+, which r.js's bundled UglifyJS can't parse.
    // Minification is done afterwards with terser.
    optimize: 'none'
})
