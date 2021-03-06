import { By } from 'selenium-webdriver';
import config from 'config';

import BaseContainer from '../../base-container.js';

export default class StartPage extends BaseContainer {
	constructor( driver, { visit = true, culture = 'en', personalPlanSetting = 'hide', flow = '' } = {} ) {
		let url;
		if ( visit === true ) {
			url = config.get( 'calypsoBaseURL' ) + '/start';

			if ( flow !== '' ) {
				url += '/' + flow;
			}

			if ( config.has( 'liveBranch' ) && config.get( 'liveBranch' ) === 'true' ) {
				url = url + '?branch=' + config.get( 'branchName' );
			}
		} else {
			url = driver.getCurrentUrl().then( ( urlDisplayed ) => {
				return urlDisplayed;
			} );
		}

		let ABTestControlFlow = flow !== '' ? flow : 'main';

		super( driver, By.css( '.step-header' ), visit, url );
		this.checkForUnknownABTestKeys();
		this.setABTestControlGroupsInLocalStorage( url, culture, ABTestControlFlow );
	}
}
