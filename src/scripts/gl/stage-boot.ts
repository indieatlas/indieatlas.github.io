/**
 * 背景の WebGL を、本文より先に描く。BaseLayout が body の先頭で、通常の（読み込みを止める）スクリプトとして読む。
 * モジュールのスクリプトでは最初の描画の後に動くことがあり、画面を移るたびに背景が一瞬地の色だけになるため
 */
import { startStage } from './stage.ts';

startStage();
