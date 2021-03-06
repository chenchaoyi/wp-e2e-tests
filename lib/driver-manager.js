import webdriver from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox';
import chrome from 'selenium-webdriver/chrome';
import config from 'config';
import path from 'path';
import assert from 'assert';
import proxy from 'selenium-webdriver/proxy';
import SauceLabs from 'saucelabs';
import _ from 'lodash';
import { times } from 'lodash';

import * as slackNotifier from './slack-notifier';

//import ProfilePage from './pages/ios/profile-page-ios.js';
//import NavbarComponent from './components/ios/navbar-component-ios.js';

// Mobile-specific
import wd from 'wd';
var wdBridge = require( 'wd-bridge' )( webdriver, wd );

const webDriverImplicitTimeOutMS = 2000;
const webDriverPageLoadTimeOutMS = 60000;
const browser = config.get( 'browser' );

export function currentScreenSize() {
	var screenSize = process.env.BROWSERSIZE;
	if ( screenSize === undefined || screenSize === '' ) {
		screenSize = 'desktop';
	}
	return screenSize.toLowerCase();
}

export function getSizeAsObject() {
	switch ( this.currentScreenSize() ) {
		case 'mobile':
			return { width: 400, height: 1000};
		case 'tablet':
			return { width: 1024, height: 1000};
		case 'desktop':
			return { width: 1440, height: 1000};
		case 'laptop':
			return { width: 1400, height: 790};
		default:
			throw new Error( 'Unsupported screen size specified. Supported values are desktop, tablet and mobile.' );
	}
}

export function getProxyType() {
	var proxyType = config.get( 'proxy' );
	switch ( proxyType.toLowerCase() ) {
		case 'direct':
			return proxy.direct();
		case 'system':
			return proxy.system();
		default:
			throw new Error( `Unknown proxy type specified of: '${proxyType}'. Supported values are 'direct' or 'system'` );
	}
}

export function startBrowser( { useCustomUA = true, resizeBrowserWindow = true } = {} ) {
	if ( global.__BROWSER__ ) {
		return global.__BROWSER__;
	}
	const screenSize = this.currentScreenSize();
	let driver;
	let options;
	let builder;
	let pref = new webdriver.logging.Preferences();
	pref.setLevel( 'browser', webdriver.logging.Level.SEVERE );
	if ( config.has( 'sauce' ) && config.get( 'sauce' ) ) {
		let sauceConfig = config.get( 'sauceConfig' );
		let caps = config.get( 'sauceConfigurations' )[ sauceConfig ];

		caps.username = config.get( 'sauceUsername' );
		caps.accessKey = config.get( 'sauceAccessKey' );
		caps.name = caps.browserName + ' - [' + screenSize + ']';
		caps.maxDuration = 2700; // 45 minutes

		if ( caps.platform.match( /Windows/ ) ) {
			caps.prerun = { executable: 'https://raw.githubusercontent.com/Automattic/wp-e2e-tests/master/fix-saucelabs-etc-hosts.bat' };
		} else {
			caps.prerun = { executable: 'https://raw.githubusercontent.com/Automattic/wp-e2e-tests/master/fix-saucelabs-etc-hosts.sh' };
		}
		if ( process.env.CIRCLE_BUILD_NUM ) {
			caps.name += ' - CircleCI Build #' + process.env.CIRCLE_BUILD_NUM;
		}

		global._sauceLabs = new SauceLabs( {
			username: caps.username,
			password: caps.accessKey
		} );

		builder = new webdriver.Builder();
		global.browserName = caps.browserName;
		global.__BROWSER__ = driver = builder.usingServer( 'http://ondemand.saucelabs.com:80/wd/hub' ).
		withCapabilities( caps ).
		build();

		driver.getSession().then( function( sessionid ) {
			driver.allPassed = true;
			driver.sessionID = sessionid.id_;
		} );
	} else {
		switch ( browser.toLowerCase() ) {
			case 'chrome':
				const adBlockPlusPath = path.resolve( __dirname, '../abp/1.13_0' );
				options = new chrome.Options();
				options.setUserPreferences( { enable_do_not_track: true } );
				options.setProxy( this.getProxyType() );
				options.addArguments( '--no-sandbox' );
				options.addArguments( `--load-extension=/${ adBlockPlusPath }` );
				options.addArguments( '--no-first-run' );
				if ( useCustomUA ) {
					options.addArguments( 'user-agent=Mozilla/5.0 (wp-e2e-tests) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.106 Safari/537.36' );
				}
				builder = new webdriver.Builder();
				builder.setChromeOptions( options );
				global.__BROWSER__ = driver = builder.forBrowser( 'chrome' ).setLoggingPrefs( pref ).build();
				global.browserName = 'chrome';
				break;
			case 'firefox':
				let profile = new firefox.Profile();
				profile.setNativeEventsEnabled( true );
				profile.setPreference( 'browser.startup.homepage_override.mstone', 'ignore' );
				profile.setPreference( 'browser.startup.homepage', 'about:blank' );
				profile.setPreference( 'startup.homepage_welcome_url.additional', 'about:blank' );
				if ( useCustomUA ) {
					profile.setPreference( 'general.useragent.override', 'Mozilla/5.0 (wp-e2e-tests) Gecko/20100101 Firefox/46.0' );
				}
				options = new firefox.Options().setProfile( profile );
				options.setProxy( this.getProxyType() );
				builder = new webdriver.Builder();
				builder.setFirefoxOptions( options );
				global.__BROWSER__ = driver = builder.forBrowser( 'firefox' ).setLoggingPrefs( pref ).build();
				global.browserName = 'firefox';
				break;
			default:
				throw new Error( `The specified browser: '${browser}' in the config is not supported. Supported browsers are 'chrome' and 'firefox'` );
		}
	}
	driver.manage().timeouts().implicitlyWait( webDriverImplicitTimeOutMS );
	driver.manage().timeouts().pageLoadTimeout( webDriverPageLoadTimeOutMS );

	if ( resizeBrowserWindow ) {
		this.resizeBrowser( driver, screenSize );
	}

	return driver;
}

export function startApp() {
	if ( global.__BROWSER__ ) {
		let d = webdriver.promise.defer();
		d.fulfill( global.__BROWSER__ );

		return d.promise;
	}
	global.__MOBILE__ = true;
	let driver, wdDriver;
	let deviceConfig = require( '../lib/mobile-capabilities' );

	//TODO: device name?	const screenSize = this.currentScreenSize();

	let caps = new webdriver.Capabilities();

	let device = deviceConfig[ process.env.DEVICE ];
	assert.notEqual( device, undefined, `ERROR! Device ${process.env.DEVICE} is not defined!` );

	_.each( device, function( val, key ) {
		caps.set( key, val );
	} );

	let builder;
	if ( config.has( 'sauce' ) && config.get( 'sauce' ) ) {
		caps.set( 'username', config.get( 'sauceUsernameIOS' ) );
		caps.set( 'accessKey', config.get( 'sauceAccessKeyIOS' ) );
		caps.set( 'name', `WordPress iOS - ${process.env.ORIENTATION} - #${process.env.CIRCLE_BUILD_NUM}` );
		builder = new webdriver.Builder()
			.usingServer( 'http://ondemand.saucelabs.com:80/wd/hub' )
			.withCapabilities( caps );
	} else if ( config.has( 'testobject' ) && config.get( 'testobject' ) ) {
		caps.set( 'testobject_api_key', config.get( 'testobjectAPIKey' ) );
		builder = new webdriver.Builder()
			.usingServer( 'http://appium.testobject.com/wd/hub' )
			.withCapabilities( caps );
	} else {
		caps.set( 'app', config.get( 'iOSLocalApp' ) );
		builder = new webdriver.Builder()
			.usingServer( 'http://localhost:4723/wd/hub' )
			.withCapabilities( caps );
	}

	global.__BROWSER__ = driver = builder.build();
	return wdBridge.initFromSeleniumWebdriver( builder, driver )
		.then( function( _wdDriver ) {
			global.__WDDRIVER__ = wdDriver = _wdDriver;
			wdDriver.getWindowSize().then( function( _screenSize ) {
				global.__originalScreenSize__ = _screenSize.height + 'x' + _screenSize.width;
			} );
			global.__HASBEENRESET__ = false;
			return wdDriver.setOrientation( process.env.ORIENTATION || 'PORTRAIT' );
		} );
}

export function resetApp() {
	if ( ! global.__HASBEENRESET__ ) {
		global.__HASBEENRESET__ = true;
		let d = webdriver.promise.defer();
		d.fulfill();
		return d.promise;
	}

	const wdDriver = global.__WDDRIVER__;
	return wdDriver.resetApp().then( function() {
		return wdDriver.setOrientation( process.env.ORIENTATION || 'PORTRAIT' );
	} );

//	const driver = global.__BROWSER__;
//TODO: This was supposed do be a smarter way to logout instead of doing a reset, but it caused problems.  May still be a way to fix this in the future
//	return driverHelper.isElementPresent( driver, webdriver.By.xpath( '//XCUIElementTypeImage[@name="icon-wp"]' ) ).then( function( atLoginScreen ) {
//		if ( ! atLoginScreen ) {
//			console.log( 'Still logged in...' );
//			let navbarComponent = new NavbarComponent( driver );
//			navbarComponent.openTab( 'Me' );
//			let profilePage = new ProfilePage( driver );
//			return profilePage.disconnectFromWPCom();
//		}
//	} );
}

export function resizeBrowser( driver, screenSize ) {
	if ( typeof ( screenSize ) === 'string' ) {
		switch ( screenSize.toLowerCase() ) {
			case 'mobile':
				driver.manage().window().setSize( 400, 1000 );
				break;
			case 'tablet':
				driver.manage().window().setSize( 1024, 1000 );
				break;
			case 'desktop':
				driver.manage().window().setSize( 1440, 1000 );
				break;
			case 'laptop':
				driver.manage().window().setSize( 1400, 790 );
				break;
			default:
				throw new Error( 'Unsupported screen size specified (' + screenSize + '). Supported values are desktop, tablet and mobile.' );
		}
	} else {
		throw new Error( 'Unsupported screen size specified (' + screenSize + '). Supported values are desktop, tablet and mobile.' );
	}
}

export function clearCookiesAndDeleteLocalStorage( driver ) {
	driver.manage().deleteAllCookies();
	return this.deleteLocalStorage( driver );
}

export function deleteLocalStorage( driver ) {
	driver.getCurrentUrl().then( ( url ) => {
		if ( url.startsWith( 'data:' ) === false && url !== 'about:blank' ) {
			return driver.executeScript( 'window.localStorage.clear();' );
		}
	} );
}

export function ensureNotLoggedIn( driver ) {
	// This makes sure neither auth domain or local domain has any cookies or local storage
	driver.get( config.get( 'authURL' ) );
	this.clearCookiesAndDeleteLocalStorage( driver );
	driver.get( config.get( 'calypsoBaseURL' ) );
	return this.clearCookiesAndDeleteLocalStorage( driver );
}

export function dismissAllAlerts( driver ) {
	times( 3, () => {
		return driver.get( 'data:,' ).then( () => {}, ( err ) => {
			return driver.sleep( 2000 ).then( () => {
				slackNotifier.warn( `Accepting an open alert: '${err}'` );
				return driver.switchTo().alert().then( function( alert ) {
					return alert.accept();
				}, () => { } );
			} );
		} );
	} );
}

export function quitBrowser( driver ) {
	// Sleep for 3 seconds before closing the browser to make sure all JS console errors are captured
	return driver.sleep( 3000 ).then( function() {
		return driver.quit();
	} );
}
