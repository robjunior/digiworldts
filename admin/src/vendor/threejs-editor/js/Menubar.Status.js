import * as THREE from 'three';

import { UIPanel, UIText } from './libs/ui.js';
import { UIBoolean } from './libs/ui.three.js';

function MenubarStatus( editor ) {

	const strings = editor.strings;

	const container = new UIPanel();
	container.setClass( 'menu right' );

	const version = new UIText( 'r' + THREE.REVISION );
	version.setClass( 'title' );
	version.setOpacity( 0.5 );
	container.add( version );

	return container;

}

export { MenubarStatus };
