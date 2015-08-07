var script1 = (function iife1() { 

	var parity = 1;
	var clickfunc = function ()
	{
		var elem = document.getElementById("img1");
		if(parity%2 == 1)
		{
			elem.src = "orange.jpg";
			elem.style.width = "400px";
			elem.style.height = "400px";
			
		}
		else
		{
			elem.src = "apple.jpg";
			elem.style.width = "100px";
			elem.style.height = "100px";
		}
		parity++;
	}

	function writecookie()
	{
		var cname = prompt("name");
		var cvalue = prompt("value");
		setCookie(cname,cvalue,5);
	}

	function setCookie(cname, cvalue, exdays) {
		var d = new Date();
		d.setTime(d.getTime() + (exdays*24*60*60*1000));
		var expires = "expires="+d.toUTCString();
		document.cookie = cname + "=" + cvalue + "; " + expires;
	} 

	function showcookie()
	{
		var elem = document.getElementById("cookies");
		elem.innerHTML = document.cookie;
	}

	function devarecookie()
	{
		var cname = prompt("name");
		setCookie(cname,"blah",-5);
	}

	return {clickfunc:clickfunc, writecookie, setCookie, showcookie, devarecookie};

}() )