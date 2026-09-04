import { encode } from './src/encoder.js';
import { decode } from './src/decoder.js';

const tests = [
  ['Alphanumeric random', 'x7pqa9mzvkt b3fqow8s2l n7adp4xz tQ91 kf8Wom2 r4xV a9Psd0 qL7nMb y2K8r fZpa61 v3Dkw9 mQo7t1s x8B2n p4Vzk0a wQ9sLd6 h7Xem2 rPa83 k0TqVz n6Wbr4s d8Yq1 mXf7pa2 zQ4KnS u9Bwt3 f5Rxa0k p7Mcd2 vq8Zla1 t4Nsy6 bKp9w q3Xvmd8 a7Lrz0f n5Qwk2 j8Ptc4 yv0Sna6 kQ7b2m z9XwPe3 d4Fsl8r h2Vqa1 c7Nmk5x p0Rty9'],
  ['Shell commands', '$ echo "Hello, World!"; printf \'%s\\n\' "$HOME"; ls -la /tmp | grep ".log" && cat file.txt; sudo -n true || echo "no sudo"; python3 -c \'print("test")\'; node -e "console.log(42)"; git status --short; git add . && git commit -m "test"; npm run build && npm start'],
  ['JSON/XML/HTML', '{ "name": "test", "value": 123, "active": true, "items": ["a","b","c"], "nested": {"x":null,"y":false} } [1,2,3,4,5,6,7,8,9,0] {"a":[{"b":"c"}]} <xml attr="value">Hello &amp; world</xml> <!-- comment --> <!DOCTYPE html>'],
  ['Code snippets', 'function test(a,b){return a+b;} const x=(a=>a*2)(21); let y=`hello ${x}!`; if(x>=42){console.log("YES");}else{console.log(\'NO\');} for(let i=0;i<10;i++){x+=i;} while(x<100){x*=2;} try{throw new Error("x");}catch(e){console.error(e);}'],
  ['SQL', 'SELECT * FROM users WHERE id=42 AND name LIKE \'%test%\' ORDER BY created_at DESC; INSERT INTO table_name (a,b,c) VALUES (1,\'x\',true); UPDATE users SET name=\'abc\', score=99 WHERE id=7; DELETE FROM users WHERE id>1000; CREATE TABLE test(id INT PRIMARY KEY,name VARCHAR(255));'],
  ['Markdown', '# README.md ## Test Project ### Features - fast - simple - random ### Code `npm install && npm run dev` **bold** *italic* [link](https://example.com) > quote --- ### End'],
  ['Hex/Binary/Oct', '0xFF 0b101010 0o755 3.1415926 1e10 -42 +17 <= >= == != === !== ++ -- += -= *= /= %= && || ! & | ^ ~ << >> >>> ** // **= ?? ?. => :: ... -> <- := :=> <= >'],
  ['Mixed symbols', '!!! ??? ::: ;;; ,,, ... """\'\'\' `~~~ ___ --- === +++ *** /// \\\\\\ ||| &&& @@@ ### $$$ %%% ^^^ &&& *** ((( ))) [[[ ]]] {{{ }}} <<< >>> <<<>>> """\'\'\'```'],
  ['Paths/URLs', 'C:\\Users\\Test\\file.txt D:\\Games\\MC\\server.exe /usr/bin/bash ~/.config/hypr/hyprland.conf ../../src/main.js ./build/output.log https://example.com/?a=1&b=2 ftp://x@y.z:21/path git@host:user/repo.git user@example.com test+tag@example.org'],
  ['Perl/Crypto', '$var1 = "hello"; @user =~ /[a-z]+/i; %hash = ("x" => 42, "y" => 99); foo(bar[0]) && baz != null || x >= 10; a++ ; --b; ptr->value; obj.method("test"); #include <stdio.h> // test /* block */ echo $PATH; export X=123; chmod +x ./run.sh; ./test --foo="bar" --x=42'],
  ['Operator soup', 'foo=bar&baz=qux?x=1#section @mention +plus -minus =equals ==double ===triple !=not !==strict <=small >=large &&and ||or !!bang **power //comment /*comment*/ <!--html--> ${variable} $(command) $((math)) ${PATH:-default}'],
  ['Brackets chain', 'Z9x8C7v6B5n4M3a2S1d0F9g8H7j6K5l4P3o2I1u0Y9t8R7e6W5q4Q3p2O1i0U9y8T7r6E5w4'],
  ['Repeating', 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp qqqq rrrr ssss tttt uuuu vvvv wwww xxxx yyyy zzzz 0000 1111 2222 3333 4444 5555 6666 7777 8888 9999'],
  ['Common English', 'the quick brown fox jumps over the lazy dog this is a test of the emergency broadcast system how now brown cow the rain in spain stays mainly on the plain'],
  ['Code: const/let', 'const app = express(); app.get("/api/tasks", async (req, res) => { const tasks = await db.query("SELECT * FROM tasks"); res.json(tasks); });'],
  ['API response', '{"status": "success", "data": {"users": [{"id": 1, "name": "John", "email": "john@example.com"}, {"id": 2, "name": "Jane", "email": "jane@example.com"}], "total": 2, "page": 1, "per_page": 10}}'],
  ['Git commands', '$ git diff --stat && npm test -- --runInBand # all files pass'],
  ['The Test Phase', 'This is The Test Phase Where we fuck ai badly but yeah you know why you are gay and apple is king'],
  ['Markdown full', '# Taskboard API\n\n## Setup\n- [ ] install dependencies\n- [x] write integration tests\n- [x] configure CI/CD\n\n## Usage\n```javascript\nconst api = require("taskboard");\napi.init({ port: 3000 });\n```\n\n> **Note:** This is a test project.'],
];

let totalIn = 0, totalOut = 0;
for (const [name, text] of tests) {
  const enc = encode(text);
  const dec = decode(enc.output);
  const ok = dec.output === text;
  const ratio = (enc.charsIn / enc.charsOut).toFixed(2);
  totalIn += enc.charsIn;
  totalOut += enc.charsOut;
  console.log(`[${ok ? '✓' : '✗'}] ${name}: ${enc.charsIn} -> ${enc.charsOut} (${ratio}x)`);
}
console.log(`\nTOTAL: ${totalIn} -> ${totalOut} (${(totalIn/totalOut).toFixed(2)}x)`);
