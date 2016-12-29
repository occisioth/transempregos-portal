"use strict";
const gulp = require("gulp"),
    sourcemaps = require("gulp-sourcemaps"),
    concat = require("gulp-concat"),
    mergeStream = require('merge-stream'),
    debug = require("gulp-debug"),
    nodemon = require('gulp-nodemon'),
    FileCache = require("gulp-file-cache"),
    sass = require('gulp-sass'),
    fs = require('fs'),
    path = require('path'),
    args = require('yargs').argv,
    plumber = require('gulp-plumber'),
    karmaServer = require('karma').Server,
    mocha = require('gulp-mocha'),
    // ts = require("gulp-typescript"), //todo: using exec until https://github.com/ivogabe/gulp-typescript/issues/460 is resolved
    { exec, spawn } = require('child_process'),
    browserSync = require('browser-sync'),
    intoStream = require('into-stream'),
    tslint = require('tslint'),
    gulpTslint = require('gulp-tslint'),
    gutil = require('gulp-util'),
    runSequence = require('run-sequence');
const { protractor } = require("gulp-protractor");

(function createGulpCacheDir() {
    var dir = path.resolve(__dirname, '.gulp-cache');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
})();

gulp.task('watch:front', ['transpile:front'], () => {
    gulp.watch('public/**/*.ts', ['transpile:front']);
    gulp.watch('public/**/*.scss', ['transpile:sass']);
    gulp.watch('public/**/*.html', ['copy:html']);
});

gulp.task('watch:back', ['transpile:back'], () => {
    return gulp.watch(['test/**/*.ts', 'server/**/*.ts'], ['transpile:back']);
});

gulp.task('watch', ['transpile'], () => {
    gulp.watch('public/**/*.ts', ['transpile:front']);
    gulp.watch('public/**/*.scss', ['transpile:sass']);
    gulp.watch('public/**/*.html', ['copy:html']);
    gulp.watch('test/**/*.ts', ['transpile:back']);
    let nodemonOpt = {
        exec: `${process.execPath} --debug --harmony-async-await`,
        script: 'dist/server/bin/www.js',
        ext: 'ts',
        env: {
            'NODE_ENV': 'development',
            DEBUG: '*,-*socket*,-engine*,-koa*,-connect*,-mquery'
        },
        watch: ['server/**/*.ts'],
        tasks: ['transpile:back'],
    };
    var stream = nodemon(nodemonOpt);
    browserSync.init({
        proxy: 'http://localhost:3000',
        files: 'dist/public/**/*',
        browser: 'chrome',
        port: 7000
    });
    stream.on('start', () => {
        browserSync.reload();
    });
    return stream;
});

gulp.task('copy', ['copy:html']);

gulp.task("copy:html", () => {
    var htmlFileCache = new FileCache('.gulp-cache/.gulp-cache-html');
    return gulp.src(["public/**/*.html"])
        .pipe(plumber())
        //.pipe(htmlFileCache.filter())
        //.pipe(htmlFileCache.cache())
        .pipe(debug({ title: 'html' }))
        .pipe(gulp.dest("dist/public"));
});

gulp.task("transpile", ['copy:html'], () => {
    var merged = new mergeStream();
    merged.add(transpileFront(), transpileBack(), transpileSass());
    return merged;
});

gulp.task("transpile:production", ['copy:html'], () => {
    var merged = new mergeStream();
    merged.add(transpileFront({ bail: true, target: 'ES5' }), transpileBack({ bail: true, target: 'ES2015' }), transpileSass({ bail: true }));
    return merged;
});

gulp.task("transpile:front", transpileFront);
gulp.task("transpile:back", transpileBack);
gulp.task("transpile:sass", transpileSass);

gulp.task("autotest", ['transpile:front'], () => {
    gulp.watch('public/**/*.ts', ['transpile:front']);
    gulp.watch(["server/**/*.ts", "test/**/*.ts"], ['transpile:back']);
    gulp.watch(["dist/server/**/*.js", "dist/test/**/*.js"], ['test:back']);
    new karmaServer({
        configFile: path.resolve(__dirname, 'karma.conf.js'),
        singleRun: false
    }).start();
});

gulp.task('test', done => runSequence('transpile', ["test:back:notranspile", "test:front:notranspile", "test:acceptance:notranspile"], done));

gulp.task("test:quick", ["test:back:notranspile", "test:front:notranspile"]);

gulp.task("test:front", ['transpile:front'], testFront);
gulp.task("test:front:notranspile", testFront);

function testFront(done) {
    new karmaServer({
        configFile: path.resolve(__dirname, 'karma.conf.js'),
        singleRun: true
    }, () => done()).start();
};

gulp.task("test:back", ['transpile:back'], testBack);
gulp.task("test:back:notranspile", testBack);

function testBack() {
    return gulp.src('dist/test/**/*.spec.js', { read: false })
        .pipe(mocha({ reporter: 'spec', require: ['./dist/test/_specHelper.js'] }));
};

gulp.task("test:acceptance", ["transpile"], testAcceptance);

gulp.task("test:acceptance:notranspile", testAcceptance);

gulp.task('run', done => {
    try {
        const node = spawn(process.execPath, ['--debug', '--harmony-async-await', 'dist/server/bin/www.js'], {
            cwd: __dirname,
            env: {
                DEBUG: '*,trans,-*socket*,-engine*,-koa*,-connect*,-mquery',
                NODE_ENV: 'development',
                DEBUG_COLORS: true
            }
        });
        node.stdout.on('data', data => {
            if (typeof (data) === 'string')
                gutil.log(data.toString());
            else
                gutil.log(data.toString('utf8'));
        });
        node.stderr.on('data', data => {
            if (typeof (data) === 'string')
                gutil.log(data.toString());
            else
                gutil.log(data.toString('utf8'));
        });
        node.on('close', code => {
            if (code > 0) {
                const message = `Running the app failed with code ${code}.`;
                gutil.log(message);
                done(message)
            }
        });
    } catch (error) {
        gutil.log(`Error: ${error}`);
        done(error);
    }
});

function testAcceptance(theDone) {
    let doneCalled = false;
    function done() {
        if (!doneCalled) {
            doneCalled = true;
            theDone(...arguments);
        }
    }
    try {
        const node = spawn(process.execPath, ['--debug', '--harmony-async-await', 'dist/server/bin/www.js'], {
            cwd: __dirname,
            env: {
                DEBUG: '*,trans,-*socket*,-engine*,-koa*,-connect*,-mquery',
                NODE_ENV: 'test',
                DEBUG_COLORS: true
            }
        });
        node.stdout.on('data', data => {
            if (typeof (data) === 'string')
                gutil.log(data.toString());
            else
                gutil.log(data.toString('utf8'));
        });
        node.stderr.on('data', data => {
            if (typeof (data) === 'string')
                gutil.log(data.toString());
            else
                gutil.log(data.toString('utf8'));
            if (data.indexOf('Listening on port') >= 0) {
                gulp.src(["./dist/test/**/*.feature.js"])
                    .pipe(protractor({
                        configFile: "dist/test/protractor.config.js",
                    }))
                    .on('error', (error) => {
                        gutil.log(error);
                        node.kill();
                        done(error);
                    })
                    .on('end', () => {
                        gutil.log('Done running tests.');
                        node.kill();
                        done();
                    });
            }
        });
        node.on('close', code => {
            if (code > 0) {
                const message = `Running the app failed with code ${code}.`;
                gutil.log(message);
                done(message)
            }
        });
    } catch (error) {
        gutil.log(`Error: ${error}`);
        done(error);
    }
};

function transpileSass(opt) {
    var sassFileCache = new FileCache('.gulp-cache/.gulp-cache-sass');
    return gulp.src(["public/**/*.scss"])
        .pipe(plumber())
        .pipe(sassFileCache.filter())
        .pipe(opt && opt.bail
            ? sass().on('error', (error) => { throw error; })
            : sass().on('error', sass.logError))
        .pipe(sassFileCache.cache())
        .pipe(debug({ title: 'sass' }))
        .pipe(gulp.dest("dist/public"));
}

// const tsProjectBack = ts.createProject("tsconfig.json");
function transpileBack(opt) {
    //todo: using exec until https://github.com/ivogabe/gulp-typescript/issues/460 is resolved
    const promise = new Promise((resolve, reject) => {
        let resolveCalled = false;
        try {
            exec(`npm run tsc -- --pretty --project ${__dirname} ${opt && opt.target ? '--target ' + opt.target : ''}`, {
                cwd: __dirname,
            }, (err, stdout, stderr) => {
                let info = "";
                if (err)
                    info += err;
                if (stderr)
                    info += stderr;
                if (stdout)
                    info += stdout;
                if (info)
                    gutil.log(info);
                resolveCalled = true;
                if (err && opt && opt.bail)
                    return reject(err);
                resolve("Done.");
            });
        } catch (error) {
            gutil.log(`Error: ${error}`);
            if (!resolveCalled)
                resolve("Done.");
        }
    });
    return intoStream(promise);
    // return tsProjectBack.src()
    //     .pipe(sourcemaps.init())
    //     .pipe(plumber())
    //     .pipe(debug({ title: 'back' }))
    //     .pipe(tsProjectBack()).js
    //     .pipe(sourcemaps.write('.'))
    //     .pipe(debug({ title: 'map' }))
    //     .pipe(gulp.dest("dist"));
}

// const tsProjectFront = ts.createProject("public/tsconfig.json");
function transpileFront(opt) {
    //todo: using exec until https://github.com/ivogabe/gulp-typescript/issues/460 is resolved
    const publicPath = path.resolve(__dirname, 'public');
    const promise = new Promise((resolve, reject) => {
        let resolveCalled = false;
        try {
            exec(`npm run tsc -- --pretty --project ${publicPath} ${opt && opt.target ? ' --target ' + opt.target : ''}`, {
                cwd: publicPath,
            }, (err, stdout, stderr) => {
                let info = "";
                if (err)
                    info += err;
                if (stderr)
                    info += stderr;
                if (stdout)
                    info += stdout;
                if (info)
                    gutil.log(info);
                resolveCalled = true;
                if (err && opt && opt.bail)
                    return reject(err);
                resolve("Done.");
            });
        } catch (error) {
            gutil.log(`Error: ${error}`);
            if (!resolveCalled)
                resolve("Done.");
        }
    });
    return intoStream(promise);
    // return tsProjectFront.src()
    //     .pipe(sourcemaps.init())
    //     .pipe(plumber())
    //     .pipe(debug({ title: 'front' }))
    //     .pipe(tsProjectFront()).js
    //     .pipe(sourcemaps.write('.'))
    //     .pipe(gulp.dest("dist/public"));
};

gulp.task('lint', ['lint:back', 'lint:front']);

gulp.task('lint:back', () => {
    return gulp.src(['server/**/*.ts', 'test/**/*.ts'], { base: '.' })
        .pipe(debug({ title: 'lint-back' }))
        .pipe(gulpTslint({ program: tslint.Linter.createProgram("./tsconfig.json"), configuration: './tslint.json' }))
        .pipe(gulpTslint.report());
});

gulp.task('lint:front', () => {
    return gulp.src(['public/**/*.ts'], { base: '.' })
        .pipe(debug({ title: 'lint-front' }))
        .pipe(gulpTslint({ program: tslint.Linter.createProgram("public/tsconfig.json"), configuration: 'public/tslint.json' }))
        .pipe(gulpTslint.report());
});

gulp.task('ci:quick', done => runSequence('ci-build', 'ci-test:quick', done));
gulp.task('ci:slow', ['ci-test:slow']);
gulp.task('ci-build', ['lint', 'transpile:production']);
gulp.task('ci-test:quick', ['test:quick']);
gulp.task('ci-test:slow', ['test:acceptance:notranspile']);

gulp.task("default", ['transpile']);