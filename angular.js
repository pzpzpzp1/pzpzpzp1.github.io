(function() {
	var app = angular.module("githubviewer",[]);
	
	var MainController = function($scope, $http){
		$scope.message="hello, angular";
		var person = {
			fname: "pal",
			lname: "zz",
			img: "http://odetocode.com/Images/scott_allen_2.jpg"
		};
		$scope.person = person;
		
		var promise = $http.get("https://api.github.com/users/pzpzpzp1");
		promise.then(
			function ongetresponse(response){
				$scope.user = response.data;
			}
			,		
			function onerror(reason){
				$scope.error = "ERROR: FAILED TO GET inFO";
			}
		)	
	}
	
	
	app.controller("MainController", ["$scope","$http",MainController]);

}())
