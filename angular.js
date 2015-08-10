(function() {
	var app = angular.module("githubviewer",[]);
	
	var MainController = function($scope, $http){
		$scope.message="github viewer";
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
		
		var onError = function(reason)
		{
			$scope.error = "Could not fetch data";
		}
		
		var onRepos = function(response){
			$scope.repos =response.data;
		}
		
		$scope.search = function()
		{
			//alert("https://api.github.com/users/"+$scope.username);
			var promise = $http.get("https://api.github.com/users/"+$scope.username);
			promise.then(
				function ongetresponse(response){
					$scope.user = response.data;
					$scope.error = "";
					$http.get($scope.user.repos_url).then(onRepos , onError);
					
				} , onError
			)
		}

		
	}
	
	
	
	app.controller("MainController", ["$scope","$http",MainController]);

}())
